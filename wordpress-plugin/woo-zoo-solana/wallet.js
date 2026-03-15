(function () {
  'use strict';

  const connectBtn = document.getElementById('connect-wallet-btn');
  const pillDot = document.getElementById('zoo-pill-dot');
  const pillText = document.getElementById('zoo-pill-text');
  const balanceBadge = document.getElementById('zoo-balance-badge');
  const gasPreview = document.getElementById('zoo-gas-preview');
  const txConfirmed = document.getElementById('zoo-tx-confirmed');
  const publicKeyInput = document.getElementById('zoo_wallet_address');

  let publicKey = null;
  let network = 'mainnet-beta';
  let zooBalance = 0;
  let isTransactionPending = false;
  let lastBalance = null;
  let lastGas = null;

  // Auto-detect network from mint: mainnet mint → mainnet RPC, else devnet
  const MAINNET_ZOO_MINT = 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3';

  function getMintAddress() {
    return (window.zoo_ajax && window.zoo_ajax.zoo_mint) ? window.zoo_ajax.zoo_mint : MAINNET_ZOO_MINT;
  }

  function detectNetwork() {
    var mint = getMintAddress();
    if (mint === MAINNET_ZOO_MINT) {
      return { network: 'mainnet-beta', rpcUrl: 'https://api.mainnet-beta.solana.com' };
    }
    return { network: 'devnet', rpcUrl: 'https://api.devnet.solana.com' };
  }

  function getConnection() {
    if (!window.solanaWeb3) return null;
    var detected = detectNetwork();
    network = detected.network;
    return new window.solanaWeb3.Connection(detected.rpcUrl, 'confirmed');
  }

  function showTooltip() {
    if (!connectBtn) return;
    let tooltip = connectBtn.querySelector('.tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'tooltip';
      connectBtn.appendChild(tooltip);
    }
    tooltip.textContent = publicKey ? `${publicKey} | ${network}` : 'Not connected';
    tooltip.style.display = 'block';
  }

  function hideTooltip() {
    if (!connectBtn) return;
    const tooltip = connectBtn.querySelector('.tooltip');
    if (tooltip) tooltip.style.display = 'none';
  }

  function updateUI() {
    if (!connectBtn) return;
    if (!publicKey) {
      if (pillText) pillText.textContent = 'Connect Wallet';
      if (pillDot) pillDot.style.backgroundColor = 'transparent';
      if (balanceBadge) {
        balanceBadge.style.display = 'none';
        balanceBadge.textContent = '';
      }
      if (gasPreview) gasPreview.textContent = '';
      connectBtn.classList.remove('pending', 'success', 'failed');
      return;
    }
    if (pillText) pillText.textContent = publicKey.slice(0, 6) + '...' + publicKey.slice(-4);
    if (pillDot) pillDot.style.backgroundColor = '#0f0';
    if (balanceBadge) {
      balanceBadge.style.display = 'inline-block';
      balanceBadge.textContent = 'ZOO: ' + Number(zooBalance).toFixed(2);
    }
    connectBtn.classList.remove('pending', 'success', 'failed');
  }

  function fillHiddenInput() {
    if (publicKeyInput && publicKey) publicKeyInput.value = publicKey;
  }

  async function fetchBalance() {
    if (!publicKey) return;
    const ajaxUrl = (window.zoo_ajax && window.zoo_ajax.ajax_url) ? window.zoo_ajax.ajax_url : '/wp-admin/admin-ajax.php';
    try {
      const res = await fetch(ajaxUrl + '?action=wcs_get_zoo_balance&wallet=' + encodeURIComponent(publicKey));
      const data = await res.json();
      const balance = (data.data && data.data.balance != null) ? data.data.balance : (data.balance != null ? data.balance : null);
      if (balance != null) {
        zooBalance = parseFloat(balance);
        if (lastBalance !== null && lastBalance != zooBalance && balanceBadge) {
          balanceBadge.classList.add('pulse');
          setTimeout(function () { balanceBadge.classList.remove('pulse'); }, 600);
        }
        lastBalance = zooBalance;
        updateUI();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function connectWallet() {
    if (!window.solana || !window.solana.isPhantom) return alert('Install Phantom Wallet');
    try {
      var detected = detectNetwork();
      network = detected.network;
      const resp = await window.solana.connect({ onlyIfTrusted: false });
      publicKey = resp.publicKey.toString();
      fillHiddenInput();
      updateUI();
      await fetchBalance();
    } catch (err) {
      console.error(err);
    }
  }

  function disconnectWallet() {
    if (window.solana && window.solana.disconnect) {
      try { window.solana.disconnect(); } catch (e) {}
    }
    publicKey = null;
    zooBalance = 0;
    lastBalance = null;
    lastGas = null;
    if (publicKeyInput) publicKeyInput.value = '';
    updateUI();
  }

  function setPendingUI() {
    if (!connectBtn) return;
    isTransactionPending = true;
    connectBtn.classList.add('pending');
    if (pillDot) pillDot.style.backgroundColor = '#0f0';
    if (pillText) pillText.textContent = 'PENDING...';
    connectBtn.disabled = true;
    connectBtn.style.cursor = 'not-allowed';
  }

  function clearPendingUI() {
    if (!connectBtn) return;
    isTransactionPending = false;
    connectBtn.classList.remove('pending', 'success', 'failed');
    connectBtn.disabled = false;
    connectBtn.style.cursor = '';
    if (gasPreview) gasPreview.textContent = '';
    if (pillDot) pillDot.style.backgroundColor = publicKey ? '#0f0' : 'transparent';
    updateUI();
  }

  async function estimateGas() {
    if (!gasPreview || !window.solana) return;
    try {
      const estimatedFee = await window.solana.request({ method: 'getRecentBlockhash' });
      const lamports = (estimatedFee && estimatedFee.value && estimatedFee.value.feeCalculator && estimatedFee.value.feeCalculator.lamportsPerSignature) ? estimatedFee.value.feeCalculator.lamportsPerSignature : 5000;
      const gasSOL = (lamports / 1e9).toFixed(6);
      if (lastGas !== null && lastGas != gasSOL) {
        gasPreview.classList.add('pulse');
        setTimeout(function () { gasPreview.classList.remove('pulse'); }, 600);
      }
      lastGas = gasSOL;
      gasPreview.textContent = 'Gas: ' + gasSOL + ' SOL';
    } catch (err) {
      console.error(err);
      gasPreview.textContent = 'Gas: ~0.000005 SOL';
    }
  }

  function showTxConfirmed() {
    if (!txConfirmed) return;
    txConfirmed.style.display = 'block';
    setTimeout(function () { txConfirmed.style.display = 'none'; }, 2000);
  }

  // When we go into the 'pending' state, we start the neon spark animation.
  async function payWithZoo(amount, order_id) {
    if (!window.solana || !publicKey) return alert('Connect Phantom first');

    setPendingUI();
    await estimateGas();

    try {
      const transactionSignature = await sendZooTokens(amount);

      if (txConfirmed) {
        txConfirmed.style.display = 'block';
        setTimeout(function () { txConfirmed.style.display = 'none'; }, 2000);
      }
      connectBtn.classList.remove('pending');
      connectBtn.classList.add('success');

      var ajaxUrl = (window.zoo_ajax && window.zoo_ajax.ajax_url) ? window.zoo_ajax.ajax_url : '/wp-admin/admin-ajax.php';
      var verifyRes = await fetch(ajaxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          action: 'zoo_verify_transaction',
          order_id: String(order_id),
          tx_signature: transactionSignature
        })
      });
      var verifyData = await verifyRes.json();

      await fetchBalance();
      return verifyData;
    } catch (err) {
      console.error(err);
      connectBtn.classList.remove('pending');
      connectBtn.classList.add('failed');
      if (pillDot) pillDot.style.backgroundColor = 'red';
      setTimeout(function () { if (connectBtn) connectBtn.classList.remove('failed'); }, 1000);
      throw err;
    }
  }

  // --- Check ZOO balance before payment ---
  async function checkZooBalance(requiredAmount) {
    if (!publicKey) return false;
    await fetchBalance();
    return zooBalance >= parseFloat(requiredAmount);
  }

  // --- SPL ZOO Transfer ---
  async function sendZooTokens(amount) {
    if (!publicKey) { alert('Connect wallet first'); return; }
    if (!window.zoo_ajax || !window.zoo_ajax.shop_wallet) { alert('ZOO config missing'); return; }

    const Solana = window.solanaWeb3;
    if (!Solana) { alert('Solana Web3 not loaded'); return; }

    const connection = getConnection();
    if (!connection) { alert('Connection not available'); return; }

    const fromPubKey = new Solana.PublicKey(publicKey);
    const toPubKey = new Solana.PublicKey(window.zoo_ajax.shop_wallet);
    const zooMint = new Solana.PublicKey(getMintAddress());

    const fromAccounts = await connection.getTokenAccountsByOwner(fromPubKey, { mint: zooMint });
    if (!fromAccounts.value.length) throw new Error('No ZOO token account');

    const toAccounts = await connection.getTokenAccountsByOwner(toPubKey, { mint: zooMint });
    if (!toAccounts.value.length) throw new Error('Recipient token account missing');

    const fromToken = fromAccounts.value[0].pubkey;
    const toToken = toAccounts.value[0].pubkey;
    const decimals = window.zoo_ajax.decimals != null ? window.zoo_ajax.decimals : 9;
    const rawAmount = Math.floor(amount * Math.pow(10, decimals));
    const TOKEN_PROGRAM_ID = new Solana.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    const data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, BigInt(rawAmount), true);

    const transferIx = new Solana.TransactionInstruction({
      keys: [
        { pubkey: fromToken, isSigner: false, isWritable: true },
        { pubkey: toToken, isSigner: false, isWritable: true },
        { pubkey: fromPubKey, isSigner: true, isWritable: false }
      ],
      programId: TOKEN_PROGRAM_ID,
      data: data
    });

    const tx = new Solana.Transaction().add(transferIx);
    tx.feePayer = fromPubKey;

    const signed = await window.solana.signAndSendTransaction(tx);
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
      : parseFloat(window.zoo_ajax && window.zoo_ajax.order_amount ? window.zoo_ajax.order_amount : 0);
    if (!cartTotal || cartTotal <= 0) { alert('Invalid order amount.'); return; }

    const hasEnough = await checkZooBalance(cartTotal);
    if (!hasEnough) {
      alert('Insufficient ZOO balance.');
      return;
    }

    try {
      var ajaxUrl = (window.zoo_ajax && window.zoo_ajax.ajax_url) ? window.zoo_ajax.ajax_url : '/wp-admin/admin-ajax.php';
      var nonce = (window.zoo_ajax && window.zoo_ajax.create_order_nonce) ? window.zoo_ajax.create_order_nonce : '';

      var createRes = await fetch(ajaxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          action: 'zoo_create_pending_order',
          nonce: nonce,
          zoo_wallet_address: publicKey || ''
        })
      });
      var createData = await createRes.json();
      if (!createData.success || !createData.data || !createData.data.order_id) {
        alert((createData.data && createData.data.message) ? createData.data.message : 'Could not create order.');
        return;
      }
      var orderId = createData.data.order_id;
      var redirectUrl = (createData.data.redirect_url) ? createData.data.redirect_url : '';

      var verifyData = await payWithZoo(cartTotal, orderId);
      clearPendingUI();

      if (!verifyData.success) {
        alert((verifyData.data && verifyData.data.message) ? verifyData.data.message : 'Verification failed. Contact support.');
        return;
      }

      window.location.href = (verifyData.data && verifyData.data.redirect_url) ? verifyData.data.redirect_url : redirectUrl || window.location.href;
    } catch (err) {
      clearPendingUI();
      alert('Transaction failed or cancelled!');
    }
  });

  if (connectBtn) {
    connectBtn.addEventListener('click', function () {
      if (isTransactionPending) return;
      if (publicKey) disconnectWallet(); else connectWallet();
    });
    connectBtn.addEventListener('mouseenter', showTooltip);
    connectBtn.addEventListener('mouseleave', hideTooltip);
  }

  setInterval(fetchBalance, 15000);

  window.addEventListener('load', function () {
    var detected = detectNetwork();
    network = detected.network;
    if (window.solana && window.solana.isPhantom) {
      window.solana.connect({ onlyIfTrusted: true }).then(function (resp) {
        if (resp && resp.publicKey) {
          publicKey = resp.publicKey.toString();
          fillHiddenInput();
          updateUI();
          fetchBalance();
        } else {
          updateUI();
        }
      }).catch(function () {
        updateUI();
      });
    } else {
      updateUI();
    }
  });
})();
