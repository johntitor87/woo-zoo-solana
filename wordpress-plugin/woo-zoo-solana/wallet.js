(function () {
  'use strict';

  var connectBtn = document.getElementById('connect-wallet-btn');
  var msgSpan = document.getElementById('zoo-wallet-msg') || document.getElementById('zoo-header-wallet-msg');

  var publicKey = null;

  function showMsg(message, isError) {
    if (msgSpan) {
      msgSpan.textContent = message || '';
      msgSpan.style.color = isError ? 'red' : 'green';
    }
  }

  function isPhantomInstalled() {
    return window.solana && window.solana.isPhantom;
  }

  function updateUIConnected() {
    if (!publicKey) return;

    showMsg('Connected: ' + publicKey);
    if (connectBtn) {
      connectBtn.textContent = 'Connected';
    }

    var walletInput = document.getElementById('zoo_wallet_address');
    if (walletInput) walletInput.value = publicKey;

    var walletDisplay = document.getElementById('zoo-wallet-display');
    if (walletDisplay) walletDisplay.textContent = 'Connected wallet: ' + publicKey;
  }

  async function connectWallet() {
    if (!isPhantomInstalled()) {
      showMsg('Phantom Wallet is not installed.', true);
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
      }
    } catch (e) {
      // silently fail
    }
  }

  if (connectBtn) {
    connectBtn.addEventListener('click', connectWallet);
  }

  window.addEventListener('load', function () {
    if (!isPhantomInstalled()) {
      showMsg('Phantom Wallet not detected.', true);
    } else {
      autoConnectWallet();
    }
  });
})();
