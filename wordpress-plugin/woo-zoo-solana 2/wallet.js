(function () {
  'use strict';

  const connectBtn = document.getElementById('connect-wallet-btn');
  const publicKeyInput = document.getElementById('zoo_wallet_address');
  let publicKey = null;
  let isConnected = false;

  // Aggressive degen colors
  const COLORS = {
    disconnected: '#111',
    connected: '#00ff00',
    hover: '#39ff14',
    text: '#00ffcc'
  };

  // Set initial style
  function styleBtnDisconnected() {
    if (!connectBtn) return;
    connectBtn.innerHTML = 'CONNECT WALLET <span class="degen-dot"></span>';
    connectBtn.style.background = COLORS.disconnected;
    connectBtn.style.color = COLORS.text;
    connectBtn.style.border = '2px solid ' + COLORS.connected;
    connectBtn.style.borderRadius = '999px';
    connectBtn.style.padding = '10px 20px';
    connectBtn.style.fontWeight = 'bold';
    connectBtn.style.fontFamily = 'monospace';
    connectBtn.style.cursor = 'pointer';
    connectBtn.style.transition = 'all 0.2s ease';
    isConnected = false;
    updateDegenNetwork();
  }

  function styleBtnConnected() {
    if (!connectBtn) return;
    connectBtn.innerHTML = 'CONNECTED <span class="degen-dot connected"></span>';
    connectBtn.style.background = COLORS.connected;
    connectBtn.style.color = '#000';
    connectBtn.style.transform = 'scale(1.05)';
    setTimeout(() => connectBtn.style.transform = 'scale(1)', 150);
    isConnected = true;
    updateDegenNetwork();
  }

  // Dot styles
  const styleDot = `
    .degen-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-left: 8px;
      border-radius: 50%;
      background-color: red;
      vertical-align: middle;
      animation: pulse 1s infinite;
    }
    .degen-dot.connected { background-color: #00ff00; }
    @keyframes pulse {
      0% { transform: scale(1); opacity: 0.7; }
      50% { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(1); opacity: 0.7; }
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.innerHTML = styleDot;
  document.head.appendChild(styleEl);

  function addNetworkBadge() {
    if (!connectBtn) return;

    let badge = document.getElementById('degen-network-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'degen-network-badge';
      badge.style.display = 'inline-block';
      badge.style.marginLeft = '8px';
      badge.style.padding = '2px 6px';
      badge.style.borderRadius = '4px';
      badge.style.fontSize = '10px';
      badge.style.fontWeight = 'bold';
      badge.style.fontFamily = 'monospace';
      badge.style.color = '#fff';
      badge.style.animation = 'flash 1.5s infinite';
      connectBtn.appendChild(badge);
    }

    const Solana = window.solanaWeb3;
    let network = 'MAINNET';
    try {
      if (Solana) {
        const url = Solana.clusterApiUrl('mainnet-beta');
        network = url.includes('devnet') ? 'DEVNET' : 'MAINNET';
      }
    } catch (e) {}

    badge.textContent = network;

    if (!document.getElementById('degen-flash-style')) {
      const flashStyle = document.createElement('style');
      flashStyle.id = 'degen-flash-style';
      flashStyle.innerHTML = `
        @keyframes flash {
          0% { background: #ff00ff; }
          25% { background: #00ffff; }
          50% { background: #39ff14; }
          75% { background: #ffdd00; }
          100% { background: #ff00ff; }
        }
        #degen-network-badge { animation: flash 1.5s infinite; }
      `;
      document.head.appendChild(flashStyle);
    }
  }

  function updateDegenNetwork() {
    addNetworkBadge();
  }

  async function connectWallet() {
    if (!window.solana || !window.solana.isPhantom) {
      alert('Install Phantom to unleash chaos!');
      return;
    }
    try {
      const resp = await window.solana.connect();
      publicKey = resp.publicKey.toString();
      styleBtnConnected();
      fillHiddenInput();
    } catch (e) { console.log('Wallet connect rejected'); }
  }

  function disconnectWallet() {
    if (!window.solana || !window.solana.isPhantom) return;
    try { window.solana.disconnect(); } catch (e) {}
    publicKey = null;
    styleBtnDisconnected();
    if (publicKeyInput) publicKeyInput.value = '';
  }

  function fillHiddenInput() {
    if (publicKeyInput && publicKey) publicKeyInput.value = publicKey;
  }

  async function autoConnectWallet() {
    if (!window.solana || !window.solana.isPhantom) return;
    try {
      const resp = await window.solana.connect({ onlyIfTrusted: true });
      if (resp && resp.publicKey) {
        publicKey = resp.publicKey.toString();
        styleBtnConnected();
        fillHiddenInput();
      }
    } catch (e) { styleBtnDisconnected(); }
  }

  // SPL ZOO Payment Function
  async function sendZooTokens(amount) {
    if (!publicKey) { alert('Connect your wallet first!'); return; }
    if (!window.zoo_ajax || !window.zoo_ajax.shop_wallet || !window.zoo_ajax.zoo_mint) {
      alert('ZOO payment not configured (shop wallet / mint).');
      return;
    }
    const Solana = window.solanaWeb3;
    const connection = new Solana.Connection(
      Solana.clusterApiUrl('mainnet-beta'),
      'confirmed'
    );

    const fromPubKey = new Solana.PublicKey(publicKey);
    const toPubKey = new Solana.PublicKey(window.zoo_ajax.shop_wallet);
    const zooMint = new Solana.PublicKey(window.zoo_ajax.zoo_mint);

    const fromAccounts = await connection.getTokenAccountsByOwner(fromPubKey, { mint: zooMint });
    if (!fromAccounts.value.length) throw new Error('No ZOO token account.');

    const toAccounts = await connection.getTokenAccountsByOwner(toPubKey, { mint: zooMint });
    if (!toAccounts.value.length) throw new Error('Recipient token account missing.');

    const fromToken = fromAccounts.value[0].pubkey;
    const toToken = toAccounts.value[0].pubkey;

    const decimals = window.zoo_ajax.decimals != null ? Number(window.zoo_ajax.decimals) : 9;
    const rawAmount = Math.floor(amount * Math.pow(10, decimals));
    const TOKEN_PROGRAM_ID = new Solana.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    // SPL Token Transfer instruction: index 3 + 8-byte amount (little-endian)
    const data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, BigInt(rawAmount), true);

    const transferIx = new Solana.TransactionInstruction({
      keys: [
        { pubkey: fromToken, isSigner: false, isWritable: true },
        { pubkey: toToken, isSigner: false, isWritable: true },
        { pubkey: fromPubKey, isSigner: true, isWritable: false },
      ],
      programId: TOKEN_PROGRAM_ID,
      data: data,
    });

    const tx = new Solana.Transaction().add(transferIx);
    tx.feePayer = fromPubKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const signed = await window.solana.signAndSendTransaction(tx);
    await connection.confirmTransaction(signed.signature);
    return signed.signature;
  }

  // Intercept Place Order for ZOO
  document.addEventListener('click', async (e) => {
    const placeOrderBtn = document.getElementById('place_order');
    if (!placeOrderBtn || e.target !== placeOrderBtn) return;

    const selected = document.querySelector('input[name="payment_method"]:checked');
    if (!selected || selected.value !== 'zoo_token') return;

    e.preventDefault();
    if (!publicKey) {
      alert('Please connect your wallet first.');
      return;
    }
    try {
      const amount = parseFloat(window.zoo_ajax.order_amount || 0);
      if (!amount || amount <= 0) {
        alert('Invalid order amount.');
        return;
      }
      const signature = await sendZooTokens(amount);

      const sigInput = document.createElement('input');
      sigInput.type = 'hidden';
      sigInput.name = 'zoo_tx_signature';
      sigInput.value = signature;
      document.querySelector('form.checkout').appendChild(sigInput);

      document.querySelector('form.checkout').submit();
    } catch (err) {
      alert('Transaction failed or cancelled!');
    }
  });

  // Connect/Disconnect toggle
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      if (!isConnected) connectWallet();
      else disconnectWallet();
    });
  }

  window.addEventListener('load', () => {
    if (window.solana && window.solana.isPhantom) {
      autoConnectWallet();
    } else {
      styleBtnDisconnected();
    }
  });
})();
