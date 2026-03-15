(function () {
  'use strict';

  const connectBtn = document.getElementById('connect-wallet-btn');
  const publicKeyInput = document.getElementById('zoo_wallet_address');
  let publicKey = null;
  let isConnected = false;
  let isTransactionPending = false;

  const COLORS = { disconnected: '#111', connected: '#00ff00', text: '#00ffcc' };

  // --- Styles ---
  function styleBtnDisconnected() {
    if (!connectBtn) return;
    connectBtn.innerHTML = 'CONNECT WALLET <span class="degen-dot"></span>';
    connectBtn.style.background = COLORS.disconnected;
    connectBtn.style.color = COLORS.text;
    connectBtn.style.border = '2px solid #00ff00';
    connectBtn.style.borderRadius = '999px';
    connectBtn.style.padding = '10px 20px';
    connectBtn.style.fontWeight = 'bold';
    connectBtn.style.fontFamily = 'monospace';
    connectBtn.style.cursor = 'pointer';
    connectBtn.style.transition = 'all 0.2s ease';
    isConnected = false;
  }

  function styleBtnConnected() {
    if (!connectBtn) return;
    connectBtn.innerHTML = 'CONNECTED <span class="degen-dot connected"></span>';
    connectBtn.style.background = COLORS.connected;
    connectBtn.style.color = '#000';
    connectBtn.style.transform = 'scale(1.05)';
    setTimeout(() => connectBtn.style.transform = 'scale(1)', 150);
    isConnected = true;
  }

  function setPendingUI() {
    if (!connectBtn) return;

    isTransactionPending = true;

    connectBtn.dataset.originalText = connectBtn.textContent;
    connectBtn.textContent = 'PENDING';

    connectBtn.style.background = 'linear-gradient(90deg, #ff00ff, #00ffff)';
    connectBtn.style.boxShadow = '0 0 10px #ff00ff, 0 0 20px #00ffff, 0 0 40px #39ff14';
    connectBtn.style.animation = 'zooNeonPulse 1.2s infinite';
    connectBtn.style.cursor = 'not-allowed';
    connectBtn.disabled = true;

    if (!document.getElementById('zoo-neon-style')) {
      const style = document.createElement('style');
      style.id = 'zoo-neon-style';
      style.innerHTML = `
        @keyframes zooNeonPulse {
          0%   { transform: scale(1); filter: brightness(1); }
          50%  { transform: scale(1.06); filter: brightness(1.4); }
          100% { transform: scale(1); filter: brightness(1); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  function clearPendingUI() {
    if (!connectBtn) return;

    isTransactionPending = false;

    connectBtn.textContent = connectBtn.dataset.originalText || 'CONNECTED';
    connectBtn.style.background = '';
    connectBtn.style.boxShadow = '';
    connectBtn.style.animation = '';
    connectBtn.style.cursor = 'pointer';
    connectBtn.disabled = false;

    if (publicKey) {
      styleBtnConnected();
      updateNetworkBadge();
    } else {
      styleBtnDisconnected();
    }
  }

  // --- Dot & flashing network ---
  const styleDot = `
    .degen-dot { display:inline-block; width:10px; height:10px; margin-left:8px; border-radius:50%; background:red; vertical-align:middle; animation:pulse 1s infinite; }
    .degen-dot.connected { background:#00ff00; }
    @keyframes pulse { 0%{transform:scale(1);opacity:.7}50%{transform:scale(1.3);opacity:1}100%{transform:scale(1);opacity:.7} }
    #degen-network-badge { display:inline-block; margin-left:6px; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; font-family:monospace; animation:flash 1.5s infinite; color:#fff; }
    @keyframes flash {0%{background:#ff00ff}25%{background:#00ffff}50%{background:#39ff14}75%{background:#ffdd00}100%{background:#ff00ff}}
  `;
  const styleEl = document.createElement('style'); styleEl.innerHTML = styleDot; document.head.appendChild(styleEl);

  // --- Animated gradient border (once) ---
  if (!document.getElementById('zoo-border-style')) {
    const borderStyle = document.createElement('style');
    borderStyle.id = 'zoo-border-style';
    borderStyle.innerHTML = `
      .zoo-gradient-border {
        position: relative;
        z-index: 1;
      }

      .zoo-gradient-border::before {
        content: "";
        position: absolute;
        inset: -2px;
        border-radius: 999px;
        padding: 2px;
        background: linear-gradient(270deg, #ff00ff, #00ffff, #39ff14, #ff00ff);
        background-size: 400% 400%;
        animation: zooBorderFlow 6s ease infinite;
        -webkit-mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
                mask-composite: exclude;
        z-index: -1;
      }

      @keyframes zooBorderFlow {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    `;
    document.head.appendChild(borderStyle);
  }
  if (connectBtn) connectBtn.classList.add('zoo-gradient-border');

  function fillHiddenInput() { if (publicKeyInput && publicKey) publicKeyInput.value = publicKey; }

  function getCurrentNetwork() {
    if (!window.solanaWeb3) return 'MAINNET';
    const url = window.solanaWeb3.clusterApiUrl('mainnet-beta');
    return url.includes('devnet') ? 'DEVNET' : 'MAINNET';
  }

  function addWalletTooltip(publicKeyVal, network) {
    if (!connectBtn) return;

    const shortKey = publicKeyVal
      ? publicKeyVal.slice(0, 4) + '...' + publicKeyVal.slice(-4)
      : 'Not Connected';

    connectBtn.title = `Wallet: ${shortKey}\nNetwork: ${network}`;
  }

  async function connectWallet() {
    if (!window.solana?.isPhantom) { alert('Install Phantom!'); return; }
    try {
      const resp = await window.solana.connect();
      publicKey = resp.publicKey.toString();
      styleBtnConnected(); fillHiddenInput(); updateNetworkBadge();
      addWalletTooltip(publicKey, getCurrentNetwork());
      const zooBalance = await getZooBalance();
      addZooBalance(zooBalance);
    } catch (e) {}
  }

  function disconnectWallet() {
    if (!window.solana?.isPhantom) return;
    try { window.solana.disconnect(); } catch(e) {}
    publicKey = null; styleBtnDisconnected();
    if (publicKeyInput) publicKeyInput.value = '';
    addWalletTooltip(null, getCurrentNetwork());
    addZooBalance(0);
  }

  async function autoConnectWallet() {
    if (!window.solana?.isPhantom) return;
    try {
      const resp = await window.solana.connect({ onlyIfTrusted:true });
      if (resp?.publicKey) {
        publicKey = resp.publicKey.toString();
        styleBtnConnected();
        fillHiddenInput();
        updateNetworkBadge();
        addWalletTooltip(publicKey, getCurrentNetwork());
        const zooBalance = await getZooBalance();
        addZooBalance(zooBalance);
      } else {
        styleBtnDisconnected();
        addWalletTooltip(null, getCurrentNetwork());
        addZooBalance(0);
      }
    } catch(e) {
      styleBtnDisconnected();
      addWalletTooltip(null, getCurrentNetwork());
      addZooBalance(0);
    }
  }

  // --- Add network badge ---
  function updateNetworkBadge() {
    if (!connectBtn || !window.solanaWeb3) return;
    let badge = document.getElementById('degen-network-badge');
    if (!badge) { badge = document.createElement('span'); badge.id = 'degen-network-badge'; connectBtn.appendChild(badge); }
    const url = window.solanaWeb3.clusterApiUrl('mainnet-beta');
    badge.textContent = url.includes('devnet') ? 'DEVNET' : 'MAINNET';
  }

  // --- Check ZOO balance before payment (before triggering Phantom) ---
  async function checkZooBalance(requiredAmount) {
    const solanaWeb3 = window.solanaWeb3;
    if (!solanaWeb3 || !publicKey) return false;
    const connection = new solanaWeb3.Connection(
      solanaWeb3.clusterApiUrl('mainnet-beta'),
      'confirmed'
    );
    const owner = new solanaWeb3.PublicKey(publicKey);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      owner,
      { programId: new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );
    let zooBalance = 0;
    tokenAccounts.value.forEach(account => {
      const info = account.account.data.parsed.info;
      if (info.mint === 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3') {
        zooBalance = info.tokenAmount.uiAmount;
      }
    });
    return zooBalance >= requiredAmount;
  }

  async function getZooBalance() {
    const solanaWeb3 = window.solanaWeb3;
    const zooMint = window.zoo_ajax?.zoo_mint || 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3';
    if (!solanaWeb3 || !publicKey) return 0;
    try {
      const connection = new solanaWeb3.Connection(
        solanaWeb3.clusterApiUrl('mainnet-beta'),
        'confirmed'
      );
      const owner = new solanaWeb3.PublicKey(publicKey);
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        owner,
        { programId: new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );
      let zooBalance = 0;
      tokenAccounts.value.forEach(account => {
        const info = account.account.data.parsed.info;
        if (info.mint === zooMint) {
          zooBalance = info.tokenAmount.uiAmount != null ? info.tokenAmount.uiAmount : 0;
        }
      });
      return zooBalance;
    } catch (e) { return 0; }
  }

  function addZooBalance(balance) {
    if (!connectBtn) return;
    let badge = document.getElementById('zoo-balance-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'zoo-balance-badge';
      badge.style.marginLeft = '10px';
      badge.style.fontSize = '11px';
      badge.style.padding = '2px 6px';
      badge.style.borderRadius = '6px';
      badge.style.background = '#111';
      badge.style.color = '#39ff14';
      badge.style.fontWeight = 'bold';
      badge.style.boxShadow = '0 0 6px #39ff14';
      connectBtn.appendChild(badge);
    }
    badge.textContent = (balance != null ? balance : 0).toFixed(2) + ' ZOO';
  }

  async function estimateFee(transaction) {
    const solanaWeb3 = window.solanaWeb3;
    if (!solanaWeb3) return 0;
    const connection = new solanaWeb3.Connection(
      solanaWeb3.clusterApiUrl('mainnet-beta')
    );
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    const fee = await connection.getFeeForMessage(
      transaction.compileMessage()
    );
    return (fee && fee.value != null ? fee.value : 0) / solanaWeb3.LAMPORTS_PER_SOL;
  }

  // --- SPL ZOO Transfer ---
  async function sendZooTokens(amount) {
    if (!publicKey) { alert('Connect wallet first'); return; }
    if (!window.zoo_ajax?.shop_wallet || !window.zoo_ajax?.zoo_mint) { alert('ZOO config missing'); return; }

    const Solana = window.solanaWeb3;
    const connection = new Solana.Connection(Solana.clusterApiUrl('mainnet-beta'), 'confirmed');
    const fromPubKey = new Solana.PublicKey(publicKey);
    const toPubKey = new Solana.PublicKey(window.zoo_ajax.shop_wallet);
    const zooMint = new Solana.PublicKey(window.zoo_ajax.zoo_mint);

    const fromAccounts = await connection.getTokenAccountsByOwner(fromPubKey, { mint:zooMint });
    if (!fromAccounts.value.length) throw new Error('No ZOO token account');

    const toAccounts = await connection.getTokenAccountsByOwner(toPubKey, { mint:zooMint });
    if (!toAccounts.value.length) throw new Error('Recipient token account missing');

    const fromToken = fromAccounts.value[0].pubkey;
    const toToken = toAccounts.value[0].pubkey;
    const rawAmount = Math.floor(amount * Math.pow(10, window.zoo_ajax.decimals||9));
    const TOKEN_PROGRAM_ID = new Solana.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    const data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, BigInt(rawAmount), true);

    const transferIx = new Solana.TransactionInstruction({
      keys: [
        { pubkey: fromToken, isSigner:false, isWritable:true },
        { pubkey: toToken, isSigner:false, isWritable:true },
        { pubkey: fromPubKey, isSigner:true, isWritable:false }
      ],
      programId: TOKEN_PROGRAM_ID,
      data: data
    });

    const tx = new Solana.Transaction().add(transferIx);
    tx.feePayer = fromPubKey;

    const feeEstimate = await estimateFee(tx);
    if (connectBtn) connectBtn.textContent = 'PENDING (~' + feeEstimate.toFixed(5) + ' SOL fee)';

    const signed = await window.solana.signAndSendTransaction(tx);
    await connection.confirmTransaction(signed.signature);
    return signed.signature;
  }

  // --- Intercept Place Order ---
  document.addEventListener('click', async (e) => {
    const placeOrderBtn = document.getElementById('place_order');
    if (!placeOrderBtn || e.target !== placeOrderBtn) return;
    const selected = document.querySelector('input[name="payment_method"]:checked');
    if (!selected || selected.value !== 'zoo_token') return;

    e.preventDefault();
    if (!publicKey) { alert('Please connect your wallet first.'); return; }
    const orderTotalEl = document.querySelector('.order-total .amount');
    const cartTotal = orderTotalEl
      ? parseFloat(orderTotalEl.innerText.replace('$', '').replace(/,/g, '')) || 0
      : parseFloat(window.zoo_ajax?.order_amount || 0);
    if (!cartTotal || cartTotal <= 0) { alert('Invalid order amount.'); return; }

    const hasEnough = await checkZooBalance(cartTotal);
    if (!hasEnough) {
      alert('Insufficient ZOO balance. Degens must reload.');
      return;
    }

    try {
      setPendingUI();

      const ajaxUrl = window.zoo_ajax?.ajax_url || '/wp-admin/admin-ajax.php';
      const nonce = window.zoo_ajax?.create_order_nonce || '';

      const createRes = await fetch(ajaxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          action: 'zoo_create_pending_order',
          nonce: nonce,
          zoo_wallet_address: publicKey || ''
        })
      });
      const createData = await createRes.json();
      if (!createData.success || !createData.data?.order_id) {
        clearPendingUI();
        alert(createData.data?.message || 'Could not create order.');
        return;
      }
      const orderId = createData.data.order_id;
      const redirectUrl = createData.data.redirect_url || '';

      const signature = await sendZooTokens(cartTotal);

      const verifyRes = await fetch(ajaxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          action: 'zoo_verify_transaction',
          order_id: orderId,
          tx_signature: signature
        })
      });
      const verifyData = await verifyRes.json();
      clearPendingUI();

      if (!verifyData.success) {
        alert(verifyData.data?.message || 'Verification failed. Contact support.');
        return;
      }

      window.location.href = verifyData.data?.redirect_url || redirectUrl || window.location.href;
    } catch(err) {
      clearPendingUI();
      alert('Transaction failed or cancelled!');
    }
  });

  if(connectBtn) connectBtn.addEventListener('click', () => {
    if (isTransactionPending) return;
    isConnected ? disconnectWallet() : connectWallet();
  });
  window.addEventListener('load', () => {
    if (window.solana?.isPhantom) autoConnectWallet();
    else {
      styleBtnDisconnected();
      addWalletTooltip(null, getCurrentNetwork());
    }
  });
})();
