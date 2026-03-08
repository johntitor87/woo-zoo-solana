console.log("ZOO DEVNET WALLET LOADED");

(function () {
  let zooWallet = null;

  const ZOO_MINT = "FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3";
  const SHOP_WALLET = "AVJqhvECgwFkMQbmmTinbf4DxPco6fhzWEpzWyGi53xa";
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
    if (connectBtn) connectBtn.innerText = "Connected";
    console.log("Connected wallet:", zooWallet);
    getZooBalance();
  }

  // Step 2 — Auto reconnect wallet
  async function autoConnect() {
    const provider = window.solana;
    if (!provider) return;
    try {
      const resp = await provider.connect({ onlyIfTrusted: true });
      zooWallet = resp.publicKey.toString();
      if (connectBtn) connectBtn.innerText = "Connected";
      console.log("Auto connected:", zooWallet);
      getZooBalance();
    } catch (e) {
      console.log("Wallet not trusted yet");
    }
  }

  document.addEventListener("DOMContentLoaded", autoConnect);

  document.addEventListener("DOMContentLoaded", function () {
    if (connectBtn) connectBtn.addEventListener("click", connectWallet);
  });

  async function getZooBalance() {
    if (!zooWallet) return;
    const connection = new solanaWeb3.Connection(
      solanaWeb3.clusterApiUrl("devnet"),
      "confirmed"
    );
    const owner = new solanaWeb3.PublicKey(zooWallet);
    const mint = new solanaWeb3.PublicKey(ZOO_MINT);
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint });
    let balance = 0;
    if (accounts.value.length) {
      balance = accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    }
    if (balanceBadge) balanceBadge.innerText = Number(balance).toLocaleString() + " ZOO";
  }

  // Step 3 — Fetch WooCommerce cart total (for later ZOO amount conversion)
  async function getCartTotal() {
    const res = await fetch("/?wc-ajax=get_cart_totals");
    const data = await res.text();
    console.log("Cart totals:", data);
    return data;
  }

  // Step 4 — Send ZOO token payment (amount = raw, 9 decimals)
  async function sendZooPayment(amount) {
    const provider = window.solana;
    if (!provider || !provider.isPhantom) throw new Error("Phantom not found");
    if (!zooWallet) throw new Error("Connect wallet first");

    const connection = new solanaWeb3.Connection(
      solanaWeb3.clusterApiUrl("devnet"),
      "confirmed"
    );
    const wallet = provider.publicKey;
    const tokenMint = new solanaWeb3.PublicKey(ZOO_MINT);
    const merchantWallet = new solanaWeb3.PublicKey(SHOP_WALLET);

    let instruction;
    if (typeof window.splToken !== "undefined" && window.splToken.getAssociatedTokenAddress && window.splToken.createTransferInstruction) {
      const fromTokenAccount = await window.splToken.getAssociatedTokenAddress(
        tokenMint,
        wallet
      );
      const toTokenAccount = await window.splToken.getAssociatedTokenAddress(
        tokenMint,
        merchantWallet
      );
      instruction = window.splToken.createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        wallet,
        amount
      );
    } else {
      const fromToken = await connection.getTokenAccountsByOwner(wallet, { mint: tokenMint });
      const toToken = await connection.getTokenAccountsByOwner(merchantWallet, { mint: tokenMint });
      if (!fromToken.value.length) throw new Error("No ZOO tokens found");
      if (!toToken.value.length) throw new Error("Merchant token account not found");
      const data = new Uint8Array(9);
      data[0] = 3;
      new DataView(data.buffer).setBigUint64(1, BigInt(amount), true);
      instruction = new solanaWeb3.TransactionInstruction({
        keys: [
          { pubkey: fromToken.value[0].pubkey, isSigner: false, isWritable: true },
          { pubkey: toToken.value[0].pubkey, isSigner: false, isWritable: true },
          { pubkey: wallet, isSigner: true, isWritable: false }
        ],
        programId: new solanaWeb3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        data: data
      });
    }

    const transaction = new solanaWeb3.Transaction().add(instruction);
    transaction.feePayer = wallet;
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    const signed = await provider.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(signature);
    return signature;
  }

  // Step 5 — Trigger payment when Place Order clicks (zoo_devnet selected)
  document.addEventListener("DOMContentLoaded", function () {
    const placeOrder = document.getElementById("place_order");
    if (!placeOrder) return;

    placeOrder.addEventListener("click", async function (e) {
      const selected = document.querySelector('input[name="payment_method"]:checked');
      if (!selected || selected.value !== "zoo_devnet") return;

      e.preventDefault();
      e.stopImmediatePropagation();

      try {
        const totalEl = document.querySelector(".order-total .amount");
        const amountUi = totalEl ? parseFloat(totalEl.innerText.replace(/[^0-9.]/g, "")) : 0;
        const amountRaw = amountUi > 0 ? Math.floor(amountUi * 1e9) : 100000000;

        const tx = await sendZooPayment(amountRaw);

        const hashEl = document.getElementById("zoo_tx_hash");
        if (hashEl) hashEl.value = tx;

        document.querySelector("form.checkout").submit();
      } catch (err) {
        console.error("Payment failed", err);
        alert("Payment cancelled");
      }
    });
  });
})();
