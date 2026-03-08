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

    const signedTx = await window.solana.signAndSendTransaction(tx);
    await connection.confirmTransaction(signedTx.signature, 'confirmed');
    return signedTx.signature;
  }

  window.sendZooTokens = function (fromPubkeyStr, amount) {
    return sendZooPayment(amount);
  };

  async function payWithZoo() {
    if (!publicKey) {
      showMsg('Connect your wallet first.', true);
      return false;
    }
    const $ = window.jQuery;
    if (!$) return false;
    const ajax = getZooAjax();
    const amount = parseFloat($('#order_review .order-total .amount').last().text().replace(/[^0-9.-]+/g, '')) || parseFloat(ajax.order_amount) || 0;
    if (!amount || amount <= 0) {
      showMsg('Invalid order amount.', true);
      return false;
    }
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

      // 2) Phantom – sign & send transaction
      const txSignature = await window.sendZooTokens(publicKey, amount);

      // 3) Verify (store pending; cron will confirm on-chain)
      const verifyResp = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature: txSignature,
          order_id: orderId,
          expectedAmount: amount,
          network: 'devnet'
        })
      });
      const verifyData = await verifyResp.json();
      if (!verifyData.success) throw new Error(verifyData.error || 'Verification failed');

      // 4) Redirect
      window.location.href = redirectUrl;
    } catch (err) {
      if (connectBtn) {
        connectBtn.classList.remove('pending');
        connectBtn.classList.add('failed');
        setTimeout(function () { connectBtn.classList.remove('failed'); }, 1000);
      }
      showMsg(err.message || 'TX failed', true);
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
    const totalEl = document.querySelector('.order-total .amount');
    const total = totalEl ? totalEl.innerText : '';
    document.getElementById('zoo-order-total').innerText = total || '—';
    const addrEl = document.getElementById('zoo-wallet-address');
    if (addrEl) addrEl.textContent = publicKey ? publicKey.slice(0, 6) + '…' + publicKey.slice(-4) : 'Not connected';
    const balanceEl = document.getElementById('zoo-balance');
    if (balanceEl) balanceEl.textContent = document.querySelector('#zoo-balance-badge') ? document.querySelector('#zoo-balance-badge').innerText : '—';
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

    const confirmBtn = document.getElementById('zoo-confirm-payment');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        closeZooModal();
        payWithZoo();
      });
    }
  });

  document.addEventListener('DOMContentLoaded', autoConnectWallet);
})();
