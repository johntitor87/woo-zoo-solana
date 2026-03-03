<?php
/**
 * Plugin Name: Woo ZOO Solana
 * Description: Full Phantom Wallet + ZOO Token integration for WooCommerce.
 * Version: 1.1
 * Author: Your Name
 */

if (!defined('ABSPATH')) exit;

// -------------------- Enqueue scripts --------------------
add_action('wp_enqueue_scripts', 'zoo_enqueue_wallet_scripts');
function zoo_enqueue_wallet_scripts() {
    if (is_admin()) return;

    // Hide any leftover old buttons
    wp_register_style('woo-zoo-solana-hide-others', false, [], '1.0');
    wp_enqueue_style('woo-zoo-solana-hide-others');
    wp_add_inline_style('woo-zoo-solana-hide-others', '#zoo-token-pay-btn,#zoo-wallet-connect,.zoo-pay-button{display:none!important;}');

    wp_enqueue_script(
        'solana-web3',
        'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.73.0/lib/index.iife.min.js',
        [],
        '1.73.0',
        true
    );

    wp_enqueue_script(
        'zoo-wallet-js',
        plugins_url('wallet.js', __FILE__),
        ['jquery', 'solana-web3'],
        '1.1',
        true
    );

    // Localize checkout order data
    if (function_exists('is_checkout') && is_checkout() && function_exists('WC') && WC()) {
        $order_total = 0;
        if (WC()->cart) $order_total = (float) WC()->cart->get_total('edit');
        $zoo_settings = get_option('woocommerce_zoo_token_settings', []);
        $api_endpoint = !empty($zoo_settings['api_endpoint']) ? $zoo_settings['api_endpoint'] : 'https://your-render-api.com/verify-payment';
        $shop_wallet = !empty($zoo_settings['shop_wallet']) ? $zoo_settings['shop_wallet'] : '';
        $zoo_mint = !empty($zoo_settings['zoo_mint']) ? $zoo_settings['zoo_mint'] : 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3';
        $decimals = !empty($zoo_settings['decimals']) ? (int)$zoo_settings['decimals'] : 9;

        wp_localize_script('zoo-wallet-js', 'zoo_ajax', [
            'order_amount' => $order_total,
            'api_endpoint' => $api_endpoint,
            'shop_wallet'  => $shop_wallet,
            'zoo_mint'     => $zoo_mint,
            'decimals'     => $decimals,
            'ajax_url'     => admin_url('admin-ajax.php'),
            'create_order_nonce' => wp_create_nonce('zoo_create_pending_order'),
        ]);
    }
}

// -------------------- Register ZOO Token Payment Gateway --------------------
add_filter('woocommerce_payment_gateways', 'zoo_add_payment_gateway');
function zoo_add_payment_gateway($gateways) {
    $gateways[] = 'WC_Zoo_Token_Gateway';
    return $gateways;
}

add_action('plugins_loaded', 'zoo_init_gateway_class', 11);
function zoo_init_gateway_class() {
    if (!class_exists('WC_Payment_Gateway')) return;

    class WC_Zoo_Token_Gateway extends WC_Payment_Gateway {
        public function __construct() {
            $this->id = 'zoo_token';
            $this->method_title = 'ZOO Token';
            $this->method_description = 'Pay with ZOO Tokens via Phantom Wallet.';
            $this->has_fields = true;

            $this->init_form_fields();
            $this->init_settings();

            $this->enabled = $this->get_option('enabled', 'yes');
            $this->title = $this->get_option('title', 'ZOO Token');

            add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
        }

        public function is_available() {
            return $this->enabled === 'yes';
        }

        public function init_form_fields() {
            $this->form_fields = [
                'enabled' => [
                    'title' => 'Enable/Disable',
                    'type' => 'checkbox',
                    'label' => 'Enable ZOO Token Payment',
                    'default' => 'yes'
                ],
                'title' => [
                    'title' => 'Title',
                    'type' => 'text',
                    'default' => 'ZOO Token'
                ],
                'api_endpoint' => [
                    'title' => 'Verification API URL',
                    'type' => 'text',
                    'description' => 'Full URL to your Render verification endpoint (e.g. https://your-app.onrender.com/verify-zoo-payment). Leave default or empty to verify on-chain in PHP.',
                    'default' => 'https://your-render-api.com/verify-zoo-payment'
                ],
                'shop_wallet' => [
                    'title' => 'Shop Wallet',
                    'type' => 'text',
                    'default' => ''
                ],
                'zoo_mint' => [
                    'title' => 'ZOO Token Mint',
                    'type' => 'text',
                    'default' => 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3'
                ],
                'decimals' => [
                    'title' => 'Decimals',
                    'type' => 'number',
                    'default' => 9
                ]
            ];
        }

        /**
         * IMPORTANT:
         * Do NOT render any buttons here.
         * Wallet UI is handled in header via JS.
         */
        public function payment_fields() {
            // We no longer render a Pay with ZOO button.
            // Only store wallet address for order processing.
            echo '<input type="hidden" id="zoo_wallet_address" name="zoo_wallet_address" value="" />';
        }
    }
}

// -------------------- Add Degen Flashy Header Wallet --------------------
add_action('wp_body_open', 'zoo_add_connect_wallet_button');
function zoo_add_connect_wallet_button() {
    if (is_admin()) return;
    ?>
    <div id="zoo-wallet-header" style="position:fixed; top:10px; right:10px; z-index:9999;">
        <button id="connect-wallet-btn" type="button" class="zoo-connect-pill">
            <span id="zoo-pill-dot"></span>
            <span id="zoo-pill-text">Connect Wallet</span>
            <span id="zoo-balance-badge"></span>
            <span id="zoo-gas-preview" style="margin-left:8px; font-size:12px; color:#0ff;"></span>
            <span id="zoo-tx-confirmed" style="position:absolute; top:-25px; left:50%; transform:translateX(-50%); color:#0f0; font-weight:bold; display:none;">TX CONFIRMED</span>
        </button>
    </div>
    <style>
        .zoo-connect-pill {
            background: linear-gradient(45deg, #ff00ff, #00ffff, #ff00ff);
            background-size: 200% 200%;
            border: 2px solid transparent;
            border-radius: 20px;
            color: white;
            padding: 10px 20px;
            font-size: 16px;
            cursor: pointer;
            position: relative;
            display: inline-flex;
            align-items: center;
            transition: transform 0.2s ease;
        }
        .zoo-connect-pill.pending {
            animation: zoo-neonSpark 2s ease-in-out infinite;
        }
        .zoo-connect-pill.success {
            animation: zoo-success-glow 1s forwards;
        }
        .zoo-connect-pill.failed {
            animation: zoo-shake 0.5s;
        }
        @keyframes zoo-neonSpark {
            0% { border-color: #ff00ff; }
            50% { border-color: #00ffff; }
            100% { border-color: #ff00ff; }
        }
        @keyframes zoo-success-glow {
            0% { box-shadow: 0 0 5px #0f0; }
            100% { box-shadow: 0 0 25px #0f0; }
        }
        @keyframes zoo-shake {
            0% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            50% { transform: translateX(5px); }
            75% { transform: translateX(-5px); }
            100% { transform: translateX(0); }
        }
        /* Balance / gas pulse */
        @keyframes zoo-microPulse {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.8; }
            100% { transform: scale(1); opacity: 1; }
        }
        .zoo-connect-pill .pulse {
            animation: zoo-microPulse 0.6s ease-in-out;
        }
        #zoo-pill-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 8px;
            background-color: transparent;
            transition: background 0.3s;
        }
        #zoo-balance-badge {
            background-color: #222;
            border-radius: 10px;
            padding: 2px 6px;
            font-size: 12px;
            margin-left: 10px;
            display: none;
        }
        .zoo-connect-pill .tooltip {
            position: absolute;
            top: -30px;
            left: 50%;
            transform: translateX(-50%);
            background: #111;
            color: #0f0;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            display: none;
        }
    </style>
    <?php
}

// -------------------- Save Wallet Address --------------------
add_action('woocommerce_checkout_update_order_meta', 'zoo_save_wallet_address');
function zoo_save_wallet_address($order_id) {
    if (!empty($_POST['zoo_wallet_address'])) {
        update_post_meta($order_id, '_zoo_wallet_address', sanitize_text_field($_POST['zoo_wallet_address']));
    }
    if (!empty($_POST['zoo_tx_signature'])) {
        $tx_hash = sanitize_text_field(wp_unslash($_POST['zoo_tx_signature']));
        update_post_meta($order_id, '_zoo_tx_hash', $tx_hash);
    }
}

// -------------------- Show Wallet on Thank You Page --------------------
add_action('woocommerce_thankyou', 'zoo_display_wallet_thankyou', 20);
function zoo_display_wallet_thankyou($order_id) {
    $wallet = get_post_meta($order_id, '_zoo_wallet_address', true);
    if ($wallet) {
        echo '<p><strong>Your ZOO Wallet used for this order:</strong> ' . esc_html($wallet) . '</p>';
    }
}

// -------------------- Show Solscan Link on Thank You Page --------------------
add_action('woocommerce_thankyou', 'zoo_display_solscan_link', 21);
function zoo_display_solscan_link($order_id) {
    $tx = get_post_meta($order_id, '_zoo_tx_hash', true);
    if ($tx) {
        echo '<p><strong>View on Solscan:</strong> ';
        echo '<a target="_blank" rel="noopener noreferrer" href="https://solscan.io/tx/' . esc_attr($tx) . '">';
        echo 'https://solscan.io/tx/' . esc_html($tx);
        echo '</a></p>';
    }
}

// -------------------- Create pending order for ZOO (AJAX) --------------------
add_action('wp_ajax_zoo_create_pending_order', 'zoo_create_pending_order');
add_action('wp_ajax_nopriv_zoo_create_pending_order', 'zoo_create_pending_order');
function zoo_create_pending_order() {
    if (!isset($_POST['nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['nonce'])), 'zoo_create_pending_order')) {
        wp_send_json_error(['message' => 'Invalid nonce']);
    }
    if (!function_exists('WC') || !WC() || !WC()->cart) {
        wp_send_json_error(['message' => 'Cart not available']);
    }
    $wallet = isset($_POST['zoo_wallet_address']) ? sanitize_text_field(wp_unslash($_POST['zoo_wallet_address'])) : '';
    if (empty($wallet)) {
        wp_send_json_error(['message' => 'Wallet address required']);
    }
    try {
        $order = wc_create_order();
        $order->set_payment_method('zoo_token');
        $order->set_payment_method_title('ZOO Token');
        foreach (WC()->cart->get_cart() as $cart_item) {
            $order->add_product($cart_item['data'], $cart_item['quantity'], $cart_item);
        }
        if (WC()->customer) {
            $order->set_address(WC()->customer->get_billing(), 'billing');
            $order->set_address(WC()->customer->get_shipping(), 'shipping');
        }
        $order->calculate_totals();
        $order->update_meta_data('_zoo_wallet_address', $wallet);
        $order->set_status('pending');
        $order->save();
        wp_send_json_success([
            'order_id'     => $order->get_id(),
            'order_key'    => $order->get_order_key(),
            'redirect_url' => $order->get_checkout_order_received_url(),
        ]);
    } catch (Exception $e) {
        wp_send_json_error(['message' => $e->getMessage()]);
    }
}

// -------------------- Verify transaction (AJAX): API or on-chain --------------------
add_action('wp_ajax_zoo_verify_transaction', 'zoo_verify_transaction');
add_action('wp_ajax_nopriv_zoo_verify_transaction', 'zoo_verify_transaction');
function zoo_verify_transaction() {
    $order_id = isset($_POST['order_id']) ? absint($_POST['order_id']) : 0;
    $signature = isset($_POST['tx_signature']) ? sanitize_text_field(wp_unslash($_POST['tx_signature'])) : '';

    if (!$order_id || !$signature) {
        wp_send_json_error(['message' => 'Missing data']);
    }

    $order = wc_get_order($order_id);
    if (!$order) {
        wp_send_json_error(['message' => 'Invalid order']);
    }

    $zoo_settings = get_option('woocommerce_zoo_token_settings', []);
    $verify_url = !empty($zoo_settings['api_endpoint']) ? trim($zoo_settings['api_endpoint']) : '';
    $use_api = $verify_url && strpos($verify_url, 'your-render-api.com') === false;

    if ($use_api) {
        $response = wp_remote_post($verify_url, [
            'headers' => ['Content-Type' => 'application/json'],
            'body'    => wp_json_encode([
                'signature'      => $signature,
                'order_id'       => $order_id,
                'expectedAmount' => $order->get_total(),
            ]),
            'timeout' => 20,
        ]);

        if (is_wp_error($response)) {
            wp_send_json_error(['message' => 'Verification server error. Try again.']);
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);

        // API may return { verified: true } (immediate) or { success: true } (pending; cron will call wcs_confirm_zoo_payment)
        $accepted = !empty($body['verified']) || !empty($body['success']);
        if (!$accepted) {
            wp_send_json_error(['message' => 'Transaction verification failed.']);
        }

        if (!empty($body['verified'])) {
            $order->payment_complete($signature);
            $order->update_meta_data('_zoo_tx_hash', $signature);
            $order->save();
            $order->add_order_note('ZOO payment verified via backend API. TX: ' . $signature);
        }
        // If success only (pending): cron will complete order via wcs_confirm_zoo_payment

        if (function_exists('WC') && WC() && WC()->cart) {
            WC()->cart->empty_cart();
        }

        wp_send_json_success(['message' => 'Verified', 'redirect_url' => $order->get_checkout_order_received_url()]);
    }

    // Fallback: verify on-chain in PHP
    $expected_wallet = !empty($zoo_settings['shop_wallet']) ? $zoo_settings['shop_wallet'] : '';
    $zoo_mint = !empty($zoo_settings['zoo_mint']) ? $zoo_settings['zoo_mint'] : 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3';
    if (empty($expected_wallet)) {
        wp_send_json_error(['message' => 'Shop wallet not configured']);
    }

    $expected_amount = floatval($order->get_total());
    $rpc_url = 'https://api.mainnet-beta.solana.com';

    $body = wp_json_encode([
        'jsonrpc' => '2.0',
        'id'      => 1,
        'method'  => 'getTransaction',
        'params'  => [
            $signature,
            ['encoding' => 'jsonParsed', 'maxSupportedTransactionVersion' => 0],
        ],
    ]);

    $response = wp_remote_post($rpc_url, [
        'headers' => ['Content-Type' => 'application/json'],
        'body'    => $body,
        'timeout' => 15,
    ]);

    if (is_wp_error($response)) {
        wp_send_json_error(['message' => 'RPC error']);
    }

    $result = json_decode(wp_remote_retrieve_body($response), true);

    if (!isset($result['result']) || $result['result'] === null) {
        wp_send_json_error(['message' => 'Transaction not found']);
    }

    $tx = $result['result'];
    $meta = isset($tx['meta']) ? $tx['meta'] : null;
    if (!$meta || !isset($meta['postTokenBalances']) || !isset($meta['preTokenBalances'])) {
        wp_send_json_error(['message' => 'Invalid transaction data']);
    }

    $pre_by_owner = [];
    foreach ($meta['preTokenBalances'] as $b) {
        $owner = isset($b['owner']) ? $b['owner'] : '';
        $mint = isset($b['mint']) ? $b['mint'] : '';
        if ($owner === $expected_wallet && $mint === $zoo_mint) {
            $pre_by_owner = $b;
            break;
        }
    }
    $post_by_owner = null;
    foreach ($meta['postTokenBalances'] as $b) {
        $owner = isset($b['owner']) ? $b['owner'] : '';
        $mint = isset($b['mint']) ? $b['mint'] : '';
        if ($owner === $expected_wallet && $mint === $zoo_mint) {
            $post_by_owner = $b;
            break;
        }
    }

    $pre_amount = 0.0;
    if (!empty($pre_by_owner) && isset($pre_by_owner['uiTokenAmount']['uiAmount'])) {
        $pre_amount = floatval($pre_by_owner['uiTokenAmount']['uiAmount']);
    }
    $post_amount = 0.0;
    if (!empty($post_by_owner) && isset($post_by_owner['uiTokenAmount']['uiAmount'])) {
        $post_amount = floatval($post_by_owner['uiTokenAmount']['uiAmount']);
    }
    $received = $post_amount - $pre_amount;

    if ($received < $expected_amount) {
        wp_send_json_error(['message' => 'Invalid transfer']);
    }

    $order->payment_complete($signature);
    $order->update_meta_data('_zoo_tx_hash', $signature);
    $order->save();
    $order->add_order_note('ZOO token payment verified on-chain. TX: ' . $signature);

    if (function_exists('WC') && WC() && WC()->cart) {
        WC()->cart->empty_cart();
    }

    wp_send_json_success(['message' => 'Verified', 'redirect_url' => $order->get_checkout_order_received_url()]);
}

// -------------------- Cron callback: complete order when backend polling verifies TX (AJAX) --------------------
// -------------------- AJAX: return ZOO token balance for wallet (for pill badge) --------------------
add_action('wp_ajax_wcs_get_zoo_balance', 'wcs_get_zoo_balance');
add_action('wp_ajax_nopriv_wcs_get_zoo_balance', 'wcs_get_zoo_balance');
function wcs_get_zoo_balance() {
    $wallet = isset($_GET['wallet']) ? sanitize_text_field(wp_unslash($_GET['wallet'])) : '';
    if (!$wallet) {
        wp_send_json_error(['balance' => 0]);
    }

    $zoo_settings = get_option('woocommerce_zoo_token_settings', []);
    $zoo_mint = !empty($zoo_settings['zoo_mint']) ? $zoo_settings['zoo_mint'] : 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3';

    if (class_exists('\\SolanaPhpRpc\\RpcClient')) {
        try {
            $connection = new \SolanaPhpRpc\RpcClient('https://api.mainnet-beta.solana.com');
            $tokenAccounts = $connection->getTokenAccountsByOwner($wallet, ['mint' => $zoo_mint]);
            $balance = 0.0;
            if (!empty($tokenAccounts['result']['value'])) {
                $amount = $tokenAccounts['result']['value'][0]['account']['data']['parsed']['info']['tokenAmount']['uiAmount'] ?? 0;
                $balance = floatval($amount);
            }
            wp_send_json_success(['balance' => $balance]);
        } catch (\Exception $e) {
            wp_send_json_error(['balance' => 0]);
        }
    }

    // Fallback: fetch via wp_remote_post when SolanaPhpRpc is not available
    $rpc_body = wp_json_encode([
        'jsonrpc' => '2.0',
        'id'      => 1,
        'method'  => 'getTokenAccountsByOwner',
        'params'  => [$wallet, ['mint' => $zoo_mint], ['encoding' => 'jsonParsed']],
    ]);
    $response = wp_remote_post('https://api.mainnet-beta.solana.com', [
        'headers' => ['Content-Type' => 'application/json'],
        'body'    => $rpc_body,
        'timeout' => 10,
    ]);
    if (is_wp_error($response)) {
        wp_send_json_error(['balance' => 0]);
    }
    $result = json_decode(wp_remote_retrieve_body($response), true);
    $balance = 0.0;
    if (!empty($result['result']['value']) && is_array($result['result']['value'])) {
        foreach ($result['result']['value'] as $account) {
            $info = $account['account']['data']['parsed']['info'] ?? null;
            if ($info && isset($info['tokenAmount']['uiAmount'])) {
                $balance = (float) $info['tokenAmount']['uiAmount'];
                break;
            }
        }
    }
    wp_send_json_success(['balance' => $balance]);
}

add_action('wp_ajax_wcs_confirm_zoo_payment', 'wcs_confirm_zoo_payment');
add_action('wp_ajax_nopriv_wcs_confirm_zoo_payment', 'wcs_confirm_zoo_payment');
function wcs_confirm_zoo_payment() {
    $order_id = intval($_POST['order_id'] ?? 0);
    $signature = sanitize_text_field($_POST['tx_signature'] ?? '');

    if (!$order_id || !$signature) {
        wp_send_json_error(['message' => 'Missing order or signature']);
    }

    $order = wc_get_order($order_id);
    if (!$order || $order->is_paid()) {
        wp_send_json_success(['message' => 'Order already paid']);
    }

    $order->payment_complete($signature);
    $order->add_order_note('ZOO payment verified via backend polling. TX: ' . $signature);

    wp_send_json_success(['message' => 'Order completed']);
}
