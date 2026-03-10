console.log('ZOO DEVNET WALLET JS LOADED');

(function () {
  'use strict';

  const splToken = window.splToken;
  if (!splToken) {
    console.error('SPL Token library not loaded');
  }

  // Devnet config (Network: https://api.devnet.solana.com)
  const DEVNET_RPC = 'https://api.devnet.solana.com';
  const ZOO_MINT = 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3';
  const SHOP_WALLET = '6XPtpWPgFfoxRcLCwxTKXawrvzeYjviw4EYpSSLW42gc';
  const VERIFY_URL = 'https://woo-solana-payment-devnet.onrender.com/verify-zoo-payment';

  const connectBtn = document.getElementById('connect-wallet-btn');
  const msgSpan = document.getElementById('zoo-wallet-msg') || document.getElementById('zoo-header-wallet-msg');
  let publicKey = null;

  function getZooAjax() {
    return window.zoo_ajax || {};
  }

  function getOrderTotal() {
    const el = document.querySelector('.order-total .woocommerce-Price-amount');
    if (!el) return 0;
    const total = el.textContent.replace(/[^0-9.]/g, '');
    return parseFloat(total) || 0;
  }

  function generateSolanaPayQR(amount) {
    const merchantWallet = SHOP_WALLET;
    const mint = ZOO_MINT;
    const solanaWeb3 = window.solanaWeb3;
    if (!solanaWeb3) return;
    const reference = solanaWeb3.Keypair.generate().publicKey.toString();
    const url = 'solana:' + merchantWallet +
      '?amount=' + amount +
      '&spl-token=' + mint +
      '&reference=' + reference;
    const qrDiv = document.getElementById('zoo-qr');
    if (!qrDiv) return;
    qrDiv.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrDiv, { text: url, width: 180, height: 180 });
    }
  }

  function showMsg(message, isError) {
    if (msgSpan) {
      msgSpan.textContent = message || '';
      msgSpan.style.color = isError ? 'red' : 'lime';
    }
  }

  function isPhantomInstalled() {
    return window.solana && window.solana.isPhantom;
  }

  function updateUIConnected() {
    if (publicKey) {
      showMsg('Wallet Connected', false);
      if (connectBtn) connectBtn.textContent = 'Connected';
    }
  }

  async function fetchZooBalance(wallet) {
    const solanaWeb3 = window.solanaWeb3;
    if (!solanaWeb3) return;
    const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'), 'confirmed');
    const mint = new solanaWeb3.PublicKey(ZOO_MINT);
    const owner = new solanaWeb3.PublicKey(wallet);
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: mint });
    let balance = 0;
    if (accounts.value.length) {
      balance = accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    }
    const badge = document.querySelector('#zoo-balance-badge');
    if (badge) badge.innerText = (balance != null ? balance : 0).toFixed(2) + ' ZOO';
  }

  function updateBalanceBadge() {
    if (publicKey) return fetchZooBalance(publicKey.toString());
  }

  async function connectWallet() {
    if (!isPhantomInstalled()) {
      showMsg('Phantom Wallet not installed.', true);
      return;
    }
    try {
      const resp = await window.solana.connect();
      publicKey = resp.publicKey.toString();
      updateUIConnected();
      await fetchZooBalance(publicKey.toString());
    } catch (e) {
      showMsg('Wallet connection rejected.', true);
    }
  }

  async function autoConnectWallet() {
    if (!isPhantomInstalled()) return;
    try {
      const resp = await window.solana.connect({ onlyIfTrusted: true });
      if (resp && resp.publicKey) {
        publicKey = resp.publicKey.toString();
        updateUIConnected();
        await fetchZooBalance(publicKey.toString());
      } else {
        showMsg('Ready to connect.', false);
      }
    } catch (e) {
      showMsg('Ready to connect.', false);
    }
  }

  async function sendZooPayment(amount) {
    if (!window.solana) throw new Error('Phantom not found');
    const solanaWeb3 = window.solanaWeb3;
    if (!solanaWeb3) throw new Error('Solana Web3 not loaded');

    const provider = window.solana;
    if (!provider.isPhantom) throw new Error('Phantom wallet not found');
    if (typeof provider.signAndSendTransaction !== 'function') {
      console.error('Phantom wallet does not support signAndSendTransaction');
      throw new Error('Phantom does not support signAndSendTransaction');
    }

    const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'), 'confirmed');
    const fromPubKey = new solanaWeb3.PublicKey(publicKey);
    const toPubKey = new solanaWeb3.PublicKey(SHOP_WALLET);
    const mintPubKey = new solanaWeb3.PublicKey(ZOO_MINT);
    const TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    const fromTokens = await connection.getTokenAccountsByOwner(fromPubKey, { mint: mintPubKey });
    if (!fromTokens.value.length) throw new Error('No ZOO token account in wallet');

    const toTokens = await connection.getTokenAccountsByOwner(toPubKey, { mint: mintPubKey });
    if (!toTokens.value.length) throw new Error('Recipient token account does not exist');

    const rawAmount = Math.floor(amount * Math.pow(10, 9));
    const data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, BigInt(rawAmount), true);

    const transferIx = new solanaWeb3.TransactionInstruction({
      keys: [
        { pubkey: fromTokens.value[0].pubkey, isSigner: false, isWritable: true },
        { pubkey: toTokens.value[0].pubkey, isSigner: false, isWritable: true },
        { pubkey: fromPubKey, isSigner: true, isWritable: false }
      ],
      programId: TOKEN_PROGRAM_ID,
      data: data
    });

    const tx = new solanaWeb3.Transaction().add(transferIx);
    const latest = await connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = fromPubKey;

    console.log('[ZOO] Sending transaction via Phantom...');
    const signedTx = await provider.signAndSendTransaction(tx);
    console.log('[ZOO] Transaction sent:', signedTx.signature);
    await connection.confirmTransaction(signedTx.signature, 'confirmed');
    return signedTx.signature;
  }

  window.sendZooTokens = function (fromPubkeyStr, amount) {
    return sendZooPayment(amount);
  };

  async function payWithZoo(amountParam) {
    console.log('[ZOO] Attempting payment...');
    if (!isPhantomInstalled()) {
      console.log('[ZOO] Phantom not installed');
      alert('Phantom Wallet is not installed!');
      showMsg('Phantom Wallet not installed.', true);
      return false;
    }
    if (!publicKey) {
      console.log('[ZOO] Wallet not connected');
      showMsg('Connect your wallet first.', true);
      alert('Connect your wallet first!');
      return false;
    }
    const ajax = getZooAjax();
    const amount = (amountParam != null && amountParam > 0) ? Number(amountParam) : (getOrderTotal() || parseFloat(ajax.order_amount) || 0);
    if (!amount || amount <= 0) {
      console.log('[ZOO] Invalid order amount:', amount);
      showMsg('Invalid order amount.', true);
      return false;
    }
    console.log('[ZOO] Sending ' + amount + ' ZOO...');
    showMsg('Processing TX...', false);
    if (connectBtn) {
      connectBtn.classList.add('pending');
      connectBtn.classList.remove('failed', 'success');
    }
    try {
      // 1) Create pending order first (get order_id for verify)
      const ajaxUrl = ajax.ajax_url || '/wp-admin/admin-ajax.php';
      const createBody = new URLSearchParams({
        action: 'zoo_create_pending_order',
        nonce: ajax.create_order_nonce || '',
        zoo_wallet_address: publicKey
      }).toString();
      const orderResp = await fetch(ajaxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: createBody
      });
      const orderData = await orderResp.json();
      if (!orderData.success) throw new Error(orderData.data?.message || 'Could not create order');
      const orderId = (orderData.data && orderData.data.order_id) || orderData.order_id;
      const redirectUrl = (orderData.data && (orderData.data.redirect_url || orderData.data.redirect)) || '/checkout/order-received/' + orderId + '/';
      if (!orderId) throw new Error('No order ID returned');
      console.log('[ZOO] Order created:', orderId);

      // 2) Phantom – sign & send transaction
      const txSignature = await window.sendZooTokens(publicKey, amount);
      console.log('[ZOO] Payment successful, tx:', txSignature);

      // 3) Verify (store pending; cron will confirm on-chain)
      const verifyPayload = {
        signature: txSignature,
        order_id: orderId,
        expectedAmount: amount,
        network: 'devnet'
      };
      console.log('[ZOO] Verifying payment...', verifyPayload);
      const verifyResp = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyPayload)
      });
      const verifyData = await verifyResp.json();
      console.log('Verification Response:', verifyData);
      if (!verifyData.success) throw new Error(verifyData.error || 'Verification failed');

      // 4) Redirect
      window.location.href = redirectUrl;
    } catch (err) {
      console.error('[ZOO] Payment error:', err);
      if (connectBtn) {
        connectBtn.classList.remove('pending');
        connectBtn.classList.add('failed');
        setTimeout(function () { connectBtn.classList.remove('failed'); }, 1000);
      }
      showMsg(err.message || 'TX failed', true);
      alert('Payment failed: ' + (err.message || 'Unknown error'));
      return false;
    }
    return true;
  }

  function checkoutWithZoo() {
    return payWithZoo();
  }

  if (connectBtn) connectBtn.addEventListener('click', connectWallet);

  function openZooModal() {
    const modal = document.getElementById('zoo-payment-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    const total = getOrderTotal();
    const totalEl = document.getElementById('zoo-order-total');
    if (totalEl) totalEl.innerText = total + ' ZOO';
    const addrEl = document.getElementById('zoo-wallet-address');
    if (addrEl) addrEl.textContent = publicKey ? publicKey.slice(0, 6) + '…' + publicKey.slice(-4) : '—';
    const balanceEl = document.getElementById('zoo-balance');
    if (balanceEl) balanceEl.textContent = document.querySelector('#zoo-balance-badge') ? document.querySelector('#zoo-balance-badge').innerText : '—';
    generateSolanaPayQR(total);
  }

  function closeZooModal() {
    const modal = document.getElementById('zoo-payment-modal');
    if (modal) modal.style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', function () {
    const placeOrderBtn = document.querySelector('#place_order');
    if (placeOrderBtn) {
      placeOrderBtn.addEventListener('click', function (e) {
        const selected = document.querySelector('input[name="payment_method"]:checked');
        if (!selected || selected.value !== 'zoo_devnet') return;
        e.preventDefault();
        e.stopPropagation();
        openZooModal();
      });
    }

    // "Pay From This Browser" – get amount and trigger payment
    const confirmBtn = document.getElementById('zoo-confirm-payment');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async function () {
        const amount = getOrderTotal();
        if (!amount) {
          alert('Invalid order amount');
          return;
        }
        if (confirmBtn.disabled) return;
        confirmBtn.disabled = true;
        try {
          await payWithZoo(amount);
        } finally {
          confirmBtn.disabled = false;
        }
      });
    }

    // Cancel – close modal
    const closeBtn = document.getElementById('zoo-close-modal');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeZooModal);
    }
  });

  // Expose for debugging (e.g. window.payWithZoo() in console)
  window.payWithZoo = payWithZoo;

  document.addEventListener('DOMContentLoaded', autoConnectWallet);
})();
