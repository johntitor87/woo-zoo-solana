/**
 * Woo ZOO Solana Gateway – zoo-wallet.js
 *
 * Fully integrated with PHP (zoo_ajax from wp_localize_script).
 * - Detects Phantom Wallet; auto-reconnect if already authorized (onlyIfTrusted).
 * - Header: Connect Wallet (connect-wallet-btn). Checkout: Pay with ZOO Token (zoo-token-pay-btn).
 * - Messages in #zoo-wallet-msg (fallback #zoo-header-wallet-msg).
 * - Sends public key, order info, and tx signature to Render API (zoo_ajax.api_endpoint).
 */
(function () {
  'use strict';

  var connectBtn = document.getElementById('connect-wallet-btn');
  var payBtn = document.getElementById('zoo-token-pay-btn');
  var msgSpan = document.getElementById('zoo-wallet-msg') || document.getElementById('zoo-header-wallet-msg');

  var publicKey = null;

  function showMsg(message, isError) {
    if (msgSpan) {
      msgSpan.textContent = message || '';
      msgSpan.style.color = (isError === true) ? 'red' : 'green';
    }
  }

  function isPhantomInstalled() {
    return window.solana && window.solana.isPhantom;
  }

  function updateUIConnected() {
    if (publicKey) {
      showMsg('Connected: ' + publicKey);
      if (connectBtn) connectBtn.textContent = 'Connected: ' + publicKey.slice(0, 6) + '...';
      if (payBtn) payBtn.disabled = false;
      var walletInput = document.getElementById('zoo_wallet_address');
      if (walletInput) walletInput.value = publicKey;
      var walletDisplay = document.getElementById('zoo-wallet-display');
      if (walletDisplay) walletDisplay.textContent = 'Connected wallet: ' + publicKey;
    }
  }

  async function connectWallet() {
    if (!isPhantomInstalled()) {
      showMsg('Phantom Wallet is not installed. Please install it.', true);
      return;
    }
    try {
      var resp = await window.solana.connect();
      publicKey = resp.publicKey.toString();
      updateUIConnected();
    } catch (err) {
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
      } else {
        showMsg('Phantom Wallet ready.');
      }
    } catch (e) {
      showMsg('Phantom Wallet ready.');
    }
  }

  var TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  var ZOO_MINT_ADDRESS = 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3';
  var ZOO_DECIMALS = 9;

  function getSolana() {
    return typeof solanaWeb3 !== 'undefined' ? solanaWeb3 : (window.solanaWeb3 || window.SolanaWeb3);
  }

  function sendZooTokens(fromPublicKey, amount) {
    var Solana = getSolana();
    if (!Solana || !Solana.Connection || !Solana.PublicKey || !Solana.Transaction) {
      throw new Error('Solana web3.js not loaded');
    }
    var zoo_ajax = window.zoo_ajax || {};
    var connection = new Solana.Connection(
      zoo_ajax.rpc_url || Solana.clusterApiUrl('mainnet-beta'),
      'confirmed'
    );
    var zooMint = zoo_ajax.zoo_mint || ZOO_MINT_ADDRESS;
    var toWalletStr = zoo_ajax.shop_wallet;
    if (!toWalletStr) throw new Error('Shop wallet not configured.');

    var fromPubKey = new Solana.PublicKey(fromPublicKey);
    var toWallet = new Solana.PublicKey(toWalletStr);
    var zooMintAddress = new Solana.PublicKey(zooMint);

    return connection.getTokenAccountsByOwner(fromPubKey, { mint: zooMintAddress }).then(function (fromTokenAccounts) {
      if (!fromTokenAccounts.value || fromTokenAccounts.value.length === 0) {
        throw new Error('No ZOO token account found in wallet.');
      }
      var fromTokenAccount = fromTokenAccounts.value[0].pubkey;
      return connection.getTokenAccountsByOwner(toWallet, { mint: zooMintAddress }).then(function (toTokenAccounts) {
        if (!toTokenAccounts.value || toTokenAccounts.value.length === 0) {
          throw new Error('Recipient token account does not exist.');
        }
        var toTokenAccount = toTokenAccounts.value[0].pubkey;
        var rawAmount = Math.floor(amount * Math.pow(10, ZOO_DECIMALS));
        var tokenProgramId = new Solana.PublicKey(TOKEN_PROGRAM_ID);
        var data = new Uint8Array(9);
        data[0] = 3;
        new DataView(data.buffer).setBigUint64(1, BigInt(rawAmount), true);
        var transferIx = new Solana.TransactionInstruction({
          keys: [
            { pubkey: fromTokenAccount, isSigner: false, isWritable: true },
            { pubkey: toTokenAccount, isSigner: false, isWritable: true },
            { pubkey: fromPubKey, isSigner: true, isWritable: false },
          ],
          programId: tokenProgramId,
          data: data,
        });
        var transaction = new Solana.Transaction().add(transferIx);
        var provider = window.solana;
        if (!provider || !provider.isPhantom) throw new Error('Phantom wallet not found');
        if (typeof provider.signAndSendTransaction === 'function') {
          return provider.signAndSendTransaction(transaction).then(function (result) {
            var sig = (typeof result === 'string') ? result : (result.signature || result.transactionSignature);
            return connection.confirmTransaction(sig, 'confirmed').then(function () { return sig; });
          });
        }
        return provider.signTransaction(transaction).then(function (signedTx) {
          return connection.sendRawTransaction(signedTx.serialize()).then(function (sig) {
            return connection.confirmTransaction(sig, 'confirmed').then(function () { return sig; });
          });
        });
      });
    });
  }

  window.sendZooTokens = sendZooTokens;

  function getOrderAmount() {
    var zoo_ajax = window.zoo_ajax;
    if (zoo_ajax) {
      if (zoo_ajax.order_amount != null && zoo_ajax.order_amount > 0) return parseFloat(zoo_ajax.order_amount);
      if (zoo_ajax.order_total != null && zoo_ajax.order_total > 0) return parseFloat(zoo_ajax.order_total);
    }
    var $ = window.jQuery;
    if ($) {
      var totalEl = $('#order_review .order-total .amount');
      if (!totalEl.length) totalEl = $('.order-total .woocommerce-Price-amount').last();
      if (totalEl.length) return parseFloat(totalEl.text().replace(/[^0-9.-]+/g, '')) || 0;
    }
    return 0;
  }

  async function payWithZoo() {
    if (!isPhantomInstalled()) {
      showMsg('Phantom Wallet is not installed. Please install it.', true);
      return;
    }
    if (!publicKey) {
      showMsg('Please connect your wallet first.', true);
      return;
    }
    if (!window.zoo_ajax) {
      showMsg('Payment config missing. Contact admin.', true);
      return;
    }

    var amount = getOrderAmount();
    if (!amount || amount <= 0) {
      showMsg('Could not get order total. Please refresh and try again.', true);
      return;
    }
    if (!window.zoo_ajax.shop_wallet) {
      showMsg('ZOO gateway is not configured.', true);
      return;
    }

    showMsg('Processing ZOO payment...', false);

    try {
      var txSignature = await sendZooTokens(publicKey, amount);

      var res = await fetch(window.zoo_ajax.api_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: window.zoo_ajax.order_id,
          order_amount: amount,
          wallet_address: publicKey,
          publicKey: publicKey,
          txSignature: txSignature,
          wallet: publicKey,
          amount: amount,
        }),
      });

      var data = await res.json();

      if (data.success || data.verified) {
        showMsg('Payment successful! Redirecting...', false);
        if (data.redirect_url) {
          window.location.href = data.redirect_url;
          return;
        }
        if (window.zoo_ajax.order_id && window.zoo_ajax.order_key && window.zoo_ajax.ajax_url) {
          var confirmRes = await fetch(window.zoo_ajax.ajax_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              action: 'wcs_confirm_zoo_payment',
              order_id: window.zoo_ajax.order_id,
              order_key: window.zoo_ajax.order_key,
              tx_signature: txSignature,
              wallet: publicKey,
            }),
          }).then(function (r) { return r.json(); });
          if (confirmRes.success && confirmRes.data && confirmRes.data.redirect) {
            window.location.href = confirmRes.data.redirect;
            return;
          }
        }
        var sigEl = document.getElementById('zoo_tx_signature');
        var walletEl = document.getElementById('zoo_wallet');
        if (sigEl) sigEl.value = txSignature;
        if (walletEl) walletEl.value = publicKey;
        var placeOrder = document.getElementById('place_order');
        if (placeOrder) placeOrder.click();
      } else {
        showMsg('Payment failed: ' + (data.error || data.message || 'Verification failed'), true);
      }
    } catch (err) {
      var msg = (err && err.message) ? err.message : 'Error processing payment';
      if (/rejected|cancelled|denied/i.test(msg)) msg = 'Transaction cancelled.';
      if (/insufficient|no.*token account|recipient/i.test(msg)) msg = 'Insufficient ZOO balance or no token account.';
      showMsg(msg, true);
    }
  }

  if (connectBtn) connectBtn.addEventListener('click', connectWallet);
  if (payBtn) {
    payBtn.addEventListener('click', payWithZoo);
    payBtn.disabled = true;
    payBtn.title = 'Connect your wallet first';
  }

  window.addEventListener('load', function () {
    if (!isPhantomInstalled()) {
      showMsg('Phantom Wallet not detected.', true);
      if (payBtn) payBtn.disabled = true;
    } else {
      autoConnectWallet();
    }
  });
})();
