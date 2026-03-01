(function () {
    'use strict';

    const connectBtn = document.getElementById('connect-wallet-btn');
    const payBtn = document.getElementById('zoo-token-pay-btn');
    const msgSpan = document.getElementById('zoo-wallet-msg');

    let publicKey = null;

    function showMsg(message, isError = false) {
        if (msgSpan) {
            msgSpan.textContent = message;
            msgSpan.style.color = isError ? 'red' : 'green';
        }
    }

    function isPhantomInstalled() {
        return window.solana && window.solana.isPhantom;
    }

    function isZooTokenSelected() {
        const selected = document.querySelector('input[name="payment_method"]:checked');
        return selected && selected.value === 'zoo_token';
    }

    function updateUIConnected() {
        if (publicKey) {
            showMsg(`Connected: ${publicKey}`);
            if (payBtn) payBtn.disabled = false;

            const walletInput = document.getElementById('zoo_wallet_address');
            if (walletInput) walletInput.value = publicKey;

            const walletDisplay = document.getElementById('zoo-wallet-display');
            if (walletDisplay) walletDisplay.textContent = `Connected wallet: ${publicKey}`;
        }
    }

    async function connectWallet() {
        if (!isPhantomInstalled()) {
            showMsg('Phantom Wallet is not installed. Please install it.', true);
            return;
        }

        try {
            const resp = await window.solana.connect();
            publicKey = resp.publicKey.toString();
            updateUIConnected();
        } catch {
            showMsg('Wallet connection rejected.', true);
        }
    }

    function handlePlaceOrderClick(e) {
        if (!isZooTokenSelected()) return;
        if (!publicKey) {
            e.preventDefault();
            showMsg('Please connect your wallet before placing the order.', true);
        }
    }

    async function autoConnectWallet() {
        if (!isPhantomInstalled()) return;

        try {
            const resp = await window.solana.connect({ onlyIfTrusted: true });
            if (resp.publicKey) {
                publicKey = resp.publicKey.toString();
                updateUIConnected();
            } else {
                showMsg('Phantom Wallet ready.');
            }
        } catch {
            showMsg('Phantom Wallet ready.');
        }
    }

    if (connectBtn) connectBtn.addEventListener('click', connectWallet);
    // Use delegation so Place Order works when button is added/updated by WooCommerce AJAX
    document.addEventListener('click', function (e) {
        if (e.target.id === 'place_order' || (e.target.type === 'submit' && e.target.name === 'woocommerce_checkout_place_order')) {
            handlePlaceOrderClick(e);
        }
    }, true);

    if (payBtn) {
        payBtn.addEventListener('click', (e) => {
            if (!publicKey) {
                e.preventDefault();
                showMsg('Please connect your wallet first.', true);
            }
        });
        payBtn.disabled = true;
        payBtn.title = 'Connect your wallet first';
    }

    window.addEventListener('load', () => {
        if (!isPhantomInstalled()) {
            showMsg('Phantom Wallet not detected.', true);
            if (payBtn) payBtn.disabled = true;
        } else {
            autoConnectWallet();
        }
    });
})();
