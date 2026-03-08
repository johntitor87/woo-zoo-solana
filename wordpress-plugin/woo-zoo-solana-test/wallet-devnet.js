console.log("ZOO DEVNET WALLET LOADED");

(function () {
  let zooWallet = null;

  const ZOO_TOKEN_MINT = new solanaWeb3.PublicKey(
    "FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3"
  );
  const STORE_WALLET = new solanaWeb3.PublicKey(
    "6XPtpWPgFfoxRcLCwxTKXawrvzeYjviw4EYpSSLW42gc"
  );
  const VERIFY_URL = "https://woo-solana-payment-devnet.onrender.com/verify-zoo-payment";

  const connectBtn = document.getElementById("connect-wallet-btn");
  const balanceBadge = document.getElementById("zoo-balance-badge");

  // Step 1 — Store wallet connection globally
  async function connectWallet() {
    const provider = window.solana;
    if (!provider || !provider.isPhantom) {
      alert("Install Phantom Wallet");
      return;
    }
    const resp = await provider.connect();
    zooWallet = resp.publicKey.toString();
    localStorage.setItem("zoo_wallet", zooWallet);
    const pillText = document.getElementById("zoo-pill-text");
    if (pillText) pillText.innerText = "🟢 Phantom Connected";
    console.log("Connected wallet:", zooWallet);
    getZooBalance(zooWallet);
  }

  // Step 2 — Auto reconnect wallet
  async function autoConnect() {
    const provider = window.solana;
    if (!provider) return;
    try {
      const resp = await provider.connect({ onlyIfTrusted: true });
      zooWallet = resp.publicKey.toString();
      const pillText = document.getElementById("zoo-pill-text");
      if (pillText) pillText.innerText = "🟢 Phantom Connected";
      console.log("Auto connected:", zooWallet);
      getZooBalance(zooWallet);
    } catch (e) {
      console.log("Wallet not trusted yet");
    }
  }

  document.addEventListener("DOMContentLoaded", autoConnect);

  document.addEventListener("DOMContentLoaded", function () {
    if (connectBtn) connectBtn.addEventListener("click", connectWallet);
  });

  async function getZooBalance(wallet) {
    if (!wallet) return;
    const connection = new solanaWeb3.Connection(
      solanaWeb3.clusterApiUrl("devnet"),
      "confirmed"
    );
    const walletPubkey = wallet instanceof solanaWeb3.PublicKey ? wallet : new solanaWeb3.PublicKey(wallet);

    const splTokenLib = window.splToken;
    if (splTokenLib && splTokenLib.getAssociatedTokenAddress) {
      try {
        const tokenAccount = await splTokenLib.getAssociatedTokenAddress(
          ZOO_TOKEN_MINT,
          walletPubkey
        );
        const balance = await connection.getTokenAccountBalance(tokenAccount);
        const uiAmount = balance.value.uiAmount;
        if (balanceBadge) {
          balanceBadge.innerText = (uiAmount != null ? Number(uiAmount).toLocaleString() : "0") + " ZOO";
        }
        console.log("ZOO balance:", balance.value.uiAmount);
      } catch (err) {
        if (balanceBadge) balanceBadge.innerText = "0 ZOO";
        console.log("ZOO balance: no token account or error", err.message);
      }
    } else {
      const accounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, { mint: ZOO_TOKEN_MINT });
      let uiAmount = 0;
      if (accounts.value.length) {
        uiAmount = accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      }
      if (balanceBadge) balanceBadge.innerText = Number(uiAmount).toLocaleString() + " ZOO";
    }

    const pillText = document.getElementById("zoo-pill-text");
    if (pillText) pillText.innerText = "🟢 Phantom Connected";
  }

  // Step 3 — Fetch WooCommerce cart total (for later ZOO amount conversion)
  async function getCartTotal() {
    const res = await fetch("/?wc-ajax=get_cart_totals");
    const data = await res.text();
    console.log("Cart totals:", data);
    return data;
  }

  // ZOO payment (amount = raw, 9 decimals). Uses splToken; Phantom only for zoo_devnet.
  async function sendZooPayment(amount) {
    const provider = window.solana;
    if (!provider || !provider.isPhantom) {
      alert("Phantom wallet not found");
      throw new Error("Phantom wallet not found");
    }

    const connection = new solanaWeb3.Connection(
      solanaWeb3.clusterApiUrl("devnet"),
      "confirmed"
    );

    const wallet = provider.publicKey;

    const splToken = window.splToken;
    if (!splToken || !splToken.getAssociatedTokenAddress || !splToken.createTransferInstruction) {
      throw new Error("SPL Token library not loaded");
    }

    const fromTokenAccount = await splToken.getAssociatedTokenAddress(
      ZOO_TOKEN_MINT,
      wallet
    );

    const toTokenAccount = await splToken.getAssociatedTokenAddress(
      ZOO_TOKEN_MINT,
      STORE_WALLET
    );

    const instruction = splToken.createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      wallet,
      amount
    );

    const transaction = new solanaWeb3.Transaction().add(instruction);

    transaction.feePayer = wallet;

    const { blockhash } = await connection.getLatestBlockhash();

    transaction.recentBlockhash = blockhash;

    const signed = await provider.signTransaction(transaction);

    const signature = await connection.sendRawTransaction(
      signed.serialize()
    );

    await connection.confirmTransaction(signature);

    console.log("ZOO payment confirmed:", signature);

    return signature;
  }

  // Create order → Pay with Phantom → Verify → Redirect. Phantom only for ZOO (zoo_devnet).
  document.addEventListener("DOMContentLoaded", function () {
    const placeOrder = document.getElementById("place_order");
    if (!placeOrder) return;

    placeOrder.addEventListener("click", async function (e) {
      const selected = document.querySelector('input[name="payment_method"]:checked');
      if (!selected || selected.value !== "zoo_devnet") {
        return; // Credit card / PayPal → normal checkout; ZOO → Phantom
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      const ajax = window.zoo_ajax || {};
      const ajaxUrl = ajax.ajax_url || "/wp-admin/admin-ajax.php";

      try {
        // Step 1 — Create pending order via AJAX
        const createBody = new URLSearchParams({
          action: "zoo_create_pending_order",
          nonce: ajax.create_order_nonce || "",
          zoo_wallet_address: zooWallet || ""
        }).toString();

        const createRes = await fetch(ajaxUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: createBody
        });
        const createData = await createRes.json();
        if (!createData.success) {
          throw new Error(createData.data?.message || "Could not create order");
        }
        const orderId = (createData.data && createData.data.order_id) || createData.order_id;
        const redirectUrl = (createData.data && (createData.data.redirect_url || createData.data.redirect)) || "/checkout/order-received/" + orderId + "/";
        if (!orderId) throw new Error("No order ID returned");

        // Step 2 — Pay with Phantom (order amount)
        const totalEl = document.querySelector(".order-total .amount");
        const amountUi = totalEl ? parseFloat(totalEl.innerText.replace(/[^0-9.]/g, "")) : 0;
        const amountRaw = amountUi > 0 ? Math.floor(amountUi * 1e9) : 100000000;

        const txSignature = await sendZooPayment(amountRaw);

        // Step 3 — Verify payment
        const verifyBody =
          "action=zoo_verify_payment" +
          "&order_id=" + encodeURIComponent(orderId) +
          "&tx=" + encodeURIComponent(txSignature);

        const verifyRes = await fetch(ajaxUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: verifyBody
        });
        const verifyData = await verifyRes.json();
        if (!verifyData.success) {
          throw new Error(verifyData.data?.message || "Verification failed");
        }

        // Step 4 — Redirect
        window.location.href = redirectUrl;
      } catch (err) {
        console.error("Payment failed", err);
        alert(err.message || "Payment cancelled");
      }
    });
  });
})();
