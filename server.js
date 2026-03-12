// server.js - Woo ZOO Token Verification (Free RPC + Auto-Poll)
const express = require('express');
const cors = require('cors');
const { Connection, clusterApiUrl, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
const winston = require('winston');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

// ------------------ CONFIG ------------------
const PORT = process.env.PORT || 3000;
const ZOO_MINT = process.env.ZOO_MINT || process.env.ZOO_MINT_ADDRESS || 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3';
// Wallet (owner) addresses only – not token accounts. Server derives ATA for verification.
const MERCHANT_WALLET = process.env.MERCHANT_WALLET || process.env.SHOP_WALLET || process.env.ZOO_SHOP_WALLET || 'AVJqhvECgwFkMQbmmTinbf4DxPco6fhzWEpzWyGi53xa';
const DEVNET_SHOP_WALLET = process.env.DEVNET_SHOP_WALLET || process.env.SHOP_WALLET || '6XPtpWPgFfoxRcLCwxTKXawrvzeYjviw4EYpSSLW42gc';
const SIGNATURE_EXPIRATION_SEC = parseInt(process.env.SIGNATURE_EXPIRATION_SEC || '600', 10); // 10 min
const WOO_AJAX_URL = process.env.WOO_AJAX_URL || process.env.WORDPRESS_AJAX_URL || 'https://your-wordpress-site.com/wp-admin/admin-ajax.php';

// In-memory store for demo (replace with DB / pending_zoo_payments for production)
const pendingTransactions = new Map();
const pendingDevnetTransactions = new Map();

// ------------------ LOGGING ------------------
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'zoo-payments.log' })
  ]
});

// ------------------ EXPRESS SETUP ------------------
const app = express();
app.use(cors());
app.use(express.json());

// ------------------ RATE LIMITER ------------------
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/verify-zoo-payment', limiter);

// ------------------ RPC CONNECTIONS ------------------
// Use 'confirmed' so cron doesn't wait for finalization. Optional: set MAINNET_RPC_URL / RPC_URL for custom RPC.
const mainnetRpc = process.env.MAINNET_RPC_URL || process.env.RPC_URL || clusterApiUrl('mainnet-beta');
const connection = new Connection(mainnetRpc, 'confirmed');
const devnetConnection = new Connection(process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');

app.use('/verify-devnet-reference', limiter);

// ------------------ VERIFY BY REFERENCE (Solana Pay QR) ------------------
app.post('/verify-devnet-reference', async (req, res) => {
  try {
    const referenceB58 = req.body.reference;
    if (!referenceB58) {
      return res.json({ success: false, valid: false, error: 'Missing reference' });
    }
    const reference = new PublicKey(referenceB58);
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const signatures = await connection.getSignaturesForAddress(reference);
    const paymentVerified = signatures.length > 0;
    return res.json({ success: paymentVerified, valid: paymentVerified });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, valid: false, error: 'Verification failed' });
  }
});

// ------------------ HEALTH CHECK ------------------
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});
app.get('/', (req, res) => res.json({ status: 'ok', service: 'ZOO verification' }));

// ------------------ VERIFY PAYMENT (single endpoint: store pending, return immediately; cron verifies) ------------------
// Body: signature (or txSignature), order_id, expectedAmount. Optional: network = 'devnet' → devnet cron; else mainnet cron.
app.post('/verify-zoo-payment', async (req, res) => {
  try {
    const { signature, order_id, expectedAmount, network } = req.body;
    const sig = signature || req.body.txSignature;
    if (!sig || expectedAmount == null || !order_id) {
      return res.status(400).json({ success: false, error: 'Missing signature, order_id, or expectedAmount' });
    }

    if (!/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(sig)) {
      return res.status(400).json({ success: false, error: 'Invalid signature format' });
    }

    const isDevnet = (network || '').toString().toLowerCase() === 'devnet';
    const pending = isDevnet ? pendingDevnetTransactions : pendingTransactions;

    if (pending.has(sig)) {
      return res.status(400).json({ success: false, error: 'Signature already pending' });
    }

    logger.info({ event: isDevnet ? 'devnet_verification_attempt' : 'verification_attempt', signature: sig, order_id, expectedAmount, network: isDevnet ? 'devnet' : 'mainnet' });

    pending.set(sig, { order_id, expectedAmount, status: 'pending', createdAt: Date.now() });

    return res.json({ success: true, message: 'Transaction pending confirmation' });
  } catch (err) {
    logger.error({ event: 'verify_error', error: err.message });
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ------------------ AUTO-POLL FOR FINALIZED ------------------
cron.schedule('*/10 * * * * *', async () => {
  for (const [signature, tx] of pendingTransactions.entries()) {
    if (tx.status !== 'pending') continue;

    try {
      const solTx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
      if (!solTx || !solTx.meta || solTx.meta.err) continue; // not finalized

      // Check transaction age
      const txTime = solTx.blockTime;
      if (!txTime || (Date.now() / 1000 - txTime) > SIGNATURE_EXPIRATION_SEC) {
        pendingTransactions.set(signature, { ...tx, status: 'failed' });
        continue;
      }

      // Validate SPL token transfer (destination is the recipient's token account / ATA)
      const instructions = solTx.transaction?.message?.instructions || [];
      let valid = false;
      const merchantAta = getAssociatedTokenAddressSync(
        new PublicKey(ZOO_MINT),
        new PublicKey(MERCHANT_WALLET)
      );

      for (const instr of instructions) {
        if (instr.program !== 'spl-token') continue;
        const info = instr.parsed?.info;
        if (
          instr.parsed?.type === 'transferChecked' &&
          info?.mint === ZOO_MINT &&
          info?.destination === merchantAta.toString() &&
          parseFloat(info?.tokenAmount?.uiAmount) === parseFloat(tx.expectedAmount)
        ) {
          valid = true;
          break;
        }
      }

      if (!valid) continue;

      // Mark verified
      pendingTransactions.set(signature, { ...tx, status: 'verified' });
      logger.info({ event: 'transaction_verified', signature, order_id: tx.order_id });

      // Call WooCommerce AJAX
      if (WOO_AJAX_URL) {
        await fetch(WOO_AJAX_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            action: 'wcs_confirm_zoo_payment',
            order_id: String(tx.order_id),
            tx_signature: signature
          })
        });
      }
    } catch (err) {
      logger.error({ event: 'poll_error', signature, error: err.message });
    }
  }
});

// ------------------ DEVNET CRON (verify pending devnet txs, then call WooCommerce) ------------------
cron.schedule('*/10 * * * * *', async () => {
  for (const [signature, tx] of pendingDevnetTransactions.entries()) {
    if (tx.status !== 'pending') continue;

    try {
      const solTx = await devnetConnection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
      if (!solTx || !solTx.meta || solTx.meta.err) continue;

      const txTime = solTx.blockTime;
      if (!txTime || Date.now() / 1000 - txTime > SIGNATURE_EXPIRATION_SEC) {
        pendingDevnetTransactions.set(signature, { ...tx, status: 'failed' });
        continue;
      }

      const instructions = solTx.transaction?.message?.instructions || [];
      let valid = false;
      const shopAta = getAssociatedTokenAddressSync(
        new PublicKey(ZOO_MINT),
        new PublicKey(DEVNET_SHOP_WALLET)
      );
      const shopAtaB58 = shopAta.toBase58();

      for (const instr of instructions) {
        if (instr.program !== 'spl-token') continue;
        const info = instr.parsed?.info;
        if (
          instr.parsed?.type === 'transferChecked' &&
          info?.mint === ZOO_MINT &&
          info?.destination === shopAtaB58 &&
          parseFloat(info?.tokenAmount?.uiAmount) === parseFloat(tx.expectedAmount)
        ) {
          valid = true;
          break;
        }
      }

      if (!valid) continue;

      pendingDevnetTransactions.set(signature, { ...tx, status: 'verified' });
      logger.info({ event: 'devnet_transaction_verified', signature, order_id: tx.order_id });

      if (WOO_AJAX_URL) {
        await fetch(WOO_AJAX_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            action: 'wcs_confirm_zoo_payment',
            order_id: String(tx.order_id),
            tx_signature: signature
          })
        });
      }
    } catch (err) {
      logger.error({ event: 'devnet_poll_error', signature, error: err.message });
    }
  }
});

// ------------------ START SERVER ------------------
app.listen(PORT, () => {
  console.log(`ZOO verification server running on port ${PORT}`);
});
