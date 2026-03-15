// wallet-devnet.js - Express router: endpoints your WooCommerce plugin can call
const express = require('express');
const router = express.Router();

// Create payment request (placeholder: later create Solana tx here)
router.post('/create-payment', async (req, res) => {
  const { orderId, amount, wallet } = req.body;

  if (!orderId || !amount) {
    return res.status(400).json({
      error: 'Missing orderId or amount'
    });
  }

  try {
    const paymentRequest = {
      orderId,
      amount,
      wallet,
      network: 'solana-devnet',
      message: 'Payment request created'
    };
    res.json(paymentRequest);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Payment creation failed'
    });
  }
});

// Verify payment (placeholder: later query Solana RPC)
router.post('/verify-payment', async (req, res) => {
  const { txSignature } = req.body;

  if (!txSignature) {
    return res.status(400).json({
      error: 'Transaction signature required'
    });
  }

  try {
    res.json({
      verified: true,
      txSignature
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Verification failed'
    });
  }
});

module.exports = router;
