console.log('ZOO DEVNET WALLET JS LOADED');

(function () {
  'use strict';

  // Devnet config (Network: https://api.devnet.solana.com)
  var DEVNET_RPC = 'https://api.devnet.solana.com';
  var ZOO_MINT = 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3';   // ZOO_MINT_ADDRESS
  var SHOP_WALLET = '6XPtpWPgFfoxRcLCwxTKXawrvzeYjviw4EYpSSLW42gc'; // merchant wallet (owner); server derives ATA – must match server DEVNET_SHOP_WALLET
  var VERIFY_URL = 'https://woo-solana-payment-devnet.onrender.com/verify-zoo-payment';

  // Flow: Phantom TX → verify (store pending) → redirect; cron verifies on-chain and marks order PAID.
  var connectBtn = document.getElementById('connect-wallet-btn');
  var msgSpan = document.getElementById('zoo-wallet-msg') || document.getElementById('zoo-header-wallet-msg');
  var publicKey = null;

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
    var solanaWeb3 = window.solanaWeb3;
    if (!solanaWeb3) return;
    var connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'), 'confirmed');
    var mint = new solanaWeb3.PublicKey('FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3');
    var owner = new solanaWeb3.PublicKey(wallet);
    var accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: mint });
    var balance = 0;
    if (accounts.value.length) {
      balance = accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    }
    var badge = document.querySelector('#zoo-balance-badge');
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
      var resp = await window.solana.connect();
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
      var resp = await window.solana.connect({ onlyIfTrusted: true });
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
    var solanaWeb3 = window.solanaWeb3;
    if (!solanaWeb3) throw new Error('Solana Web3 not loaded');

    var connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'), 'confirmed');
    var fromPubKey = new solanaWeb3.PublicKey(publicKey);
    var toPubKey = new solanaWeb3.PublicKey(SHOP_WALLET);
    var mintPubKey = new solanaWeb3.PublicKey(ZOO_MINT);
    var TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    var fromTokens = await connection.getTokenAccountsByOwner(fromPubKey, { mint: mintPubKey });
    if (!fromTokens.value.length) throw new Error('No ZOO token account in wallet');

    var toTokens = await connection.getTokenAccountsByOwner(toPubKey, { mint: mintPubKey });
    if (!toTokens.value.length) throw new Error('Recipient token account does not exist');

    var rawAmount = Math.floor(amount * Math.pow(10, 9));
    var data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, BigInt(rawAmount), true);

    var transferIx = new solanaWeb3.TransactionInstruction({
      keys: [
        { pubkey: fromTokens.value[0].pubkey, isSigner: false, isWritable: true },
        { pubkey: toTokens.value[0].pubkey, isSigner: false, isWritable: true },
        { pubkey: fromPubKey, isSigner: true, isWritable: false }
      ],
      programId: TOKEN_PROGRAM_ID,
      data: data
    });

    var tx = new solanaWeb3.Transaction().add(transferIx);

    var latest = await connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = fromPubKey;

    var signedTx = await window.solana.signAndSendTransaction(tx);
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
    var $ = window.jQuery;
    if (!$) return false;
    var ajax = getZooAjax();
    var amount = parseFloat($('#order_review .order-total .amount').last().text().replace(/[^0-9.-]+/g, '')) || parseFloat(ajax.order_amount) || 0;
    if (!amount || amount <= 0) {
      showMsg('Invalid order amount.', true);
      return false;
    }
    var orderId = ajax.order_id || 0;
    if (!orderId) {
      showMsg('No order found. Please place order first.', true);
      return false;
    }
    showMsg('Processing TX...', false);
    if (connectBtn) {
      connectBtn.classList.add('pending');
      connectBtn.classList.remove('failed', 'success');
    }
    try {
      // 1) Phantom TX
      var txSignature = await window.sendZooTokens(publicKey, amount);

      // 2) Send TX signature to Render API; server stores pending, cron verifies on-chain and calls WooCommerce
      var verifyResp = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature: txSignature,
          order_id: orderId,
          expectedAmount: amount,
          network: 'devnet'
        })
      });
      var verifyData = await verifyResp.json();
      if (!verifyData.success) {
        throw new Error(verifyData.error || 'Transaction pending verification');
      }

      // 3) Redirect; cron will mark order PAID
      window.location.href = ajax.order_received_url || '/checkout/';
      return true;
    } catch (err) {
      if (connectBtn) {
        connectBtn.classList.remove('pending');
        connectBtn.classList.add('failed');
        setTimeout(function () { connectBtn.classList.remove('failed'); }, 1000);
      }
      showMsg(err.message || 'TX failed', true);
      return false;
    }
  }

  function checkoutWithZoo() {
    return payWithZoo();
  }

  if (connectBtn) connectBtn.addEventListener('click', connectWallet);

  function openZooModal() {
    var modal = document.getElementById('zoo-payment-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    var totalEl = document.querySelector('.order-total .amount');
    var total = totalEl ? totalEl.innerText : '';
    document.getElementById('zoo-order-total').innerText = total || '—';
    var addrEl = document.getElementById('zoo-wallet-address');
    if (addrEl) addrEl.textContent = publicKey ? publicKey.slice(0, 6) + '…' + publicKey.slice(-4) : 'Not connected';
    var balanceEl = document.getElementById('zoo-balance');
    if (balanceEl) balanceEl.textContent = document.querySelector('#zoo-balance-badge') ? document.querySelector('#zoo-balance-badge').innerText : '—';
  }

  function closeZooModal() {
    var modal = document.getElementById('zoo-payment-modal');
    if (modal) modal.style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var placeOrderBtn = document.querySelector('#place_order');
    if (placeOrderBtn) {
      placeOrderBtn.addEventListener('click', function (e) {
        var selected = document.querySelector('input[name="payment_method"]:checked');
        if (!selected || selected.value !== 'zoo_devnet') return;
        e.preventDefault();
        e.stopPropagation();
        openZooModal();
      });
    }

    var confirmBtn = document.getElementById('zoo-confirm-payment');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async function () {
        var provider = window.solana;
        if (!provider) {
          alert('Phantom wallet not found');
          return;
        }
        if (!publicKey) {
          alert('Connect your wallet first');
          closeZooModal();
          return;
        }
        closeZooModal();
        await payWithZoo();
      });
    }
  });

  window.addEventListener('load', autoConnectWallet);
})();
