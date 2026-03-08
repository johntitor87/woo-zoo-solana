<?php
/**
 * Plugin Name: Woo ZOO Solana Devnet
 * Description: Test version for ZOO Token on devnet. Flashy degen wallet pill, Phantom integration, animations.
 * Version: 1.0
 * Author: Your Name
 */

if (!defined('ABSPATH')) exit;

// -------------------- Enqueue Scripts --------------------
// Order guarantees: solana-web3 → solana-spl-token → zoo-wallet-devnet (wallet waits for both libraries).
add_action('wp_enqueue_scripts', function () {

    if (is_admin()) return;

    // Solana Web3
    wp_enqueue_script(
        'solana-web3',
        'https://unpkg.com/@solana/web3.js@latest/lib/index.iife.js',
        [],
        null,
        true
    );

    // SPL Token Library
    wp_enqueue_script(
        'solana-spl-token',
        'https://unpkg.com/@solana/spl-token@latest/lib/index.iife.js',
        ['solana-web3'],
        null,
        true
    );

    // QR Code Generator
    wp_enqueue_script(
        'qrcodejs',
        'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
        [],
        '1.0.0',
        true
    );

    // ZOO Wallet Script
    wp_enqueue_script(
        'zoo-wallet-devnet',
        plugin_dir_url(__FILE__) . 'wallet-devnet.js',
        ['solana-web3','solana-spl-token'],
        '1.0',
        true
    );

}, 10);

add_action('wp_enqueue_scripts', 'zoo_enqueue_wallet_scripts_devnet');
function zoo_enqueue_wallet_scripts_devnet() {
    if (is_admin()) return;

    // Hide other wallet UI
    wp_register_style('woo-zoo-hide-others', false, [], '1.0');
    wp_enqueue_style('woo-zoo-hide-others');
    wp_add_inline_style('woo-zoo-hide-others', '#zoo-wallet-connect,.zoo-wallet-nav-item,.zoo-wallet-btn,.zoo-pay-button{display:none!important;}');

    // Wallet pill animations
    wp_register_style('woo-zoo-pill-animations', false, [], '1.0');
    wp_enqueue_style('woo-zoo-pill-animations');
    wp_add_inline_style('woo-zoo-pill-animations', '/* Wallet pill animations */
#connect-wallet-btn{position:relative;transition:all 0.3s ease;overflow:hidden;}
#connect-wallet-btn.pending::after{content:\'\';position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;background:lime;animation:flash 1s infinite;}
#connect-wallet-btn.failed{animation:shake 0.5s;box-shadow:0 0 8px red;}
#connect-wallet-btn.success{box-shadow:0 0 10px lime;animation:confirmFlash 0.8s;}
@keyframes flash{0%,50%,100%{opacity:1;}25%,75%{opacity:0;}}
@keyframes shake{0%,100%{transform:translateX(0);}20%,60%{transform:translateX(-5px);}40%,80%{transform:translateX(5px);}}
@keyframes confirmFlash{0%{box-shadow:0 0 0px lime;}50%{box-shadow:0 0 15px lime;}100%{box-shadow:0 0 0px lime;}}');

    // solana-web3 and zoo-wallet-js-devnet enqueued in earlier hook (every page)
    // Localize for checkout
    if (function_exists('is_checkout') && is_checkout() && function_exists('WC') && WC()) {
        $order_total = 0;
        $order_id = 0;
        if (WC()->session) $order_id = WC()->session->get('order_awaiting_payment');
        if (WC()->cart) $order_total = (float) WC()->cart->get_total('edit');
        $order_received_url = '';
        if ($order_id) {
            $order = wc_get_order($order_id);
            $order_received_url = $order ? $order->get_checkout_order_received_url() : '';
        }

        wp_localize_script('zoo-wallet-devnet', 'zoo_ajax', [
            'order_id' => $order_id,
            'order_amount' => $order_total,
            'order_received_url' => $order_received_url,
            'api_endpoint' => 'https://woo-solana-payment-devnet.onrender.com',
            'shop_wallet' => '6XPtpWPgFfoxRcLCwxTKXawrvzeYjviw4EYpSSLW42gc',
            'rpc_url' => 'https://api.devnet.solana.com',
            'zoo_mint' => 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3',
            'ajax_url' => admin_url('admin-ajax.php'),
            'create_order_nonce' => wp_create_nonce('zoo_create_pending_order'),
            'decimals' => 9,
        ]);
    } else {
        wp_localize_script('zoo-wallet-devnet', 'zoo_ajax', [
            'order_id' => 0,
            'order_amount' => 0,
            'order_received_url' => '',
            'api_endpoint' => 'https://woo-solana-payment-devnet.onrender.com',
            'shop_wallet' => '6XPtpWPgFfoxRcLCwxTKXawrvzeYjviw4EYpSSLW42gc',
            'rpc_url' => 'https://api.devnet.solana.com',
            'zoo_mint' => 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3',
            'ajax_url' => admin_url('admin-ajax.php'),
            'create_order_nonce' => '',
            'decimals' => 9,
        ]);
    }
}

// -------------------- Payment Modal (footer) --------------------
add_action('wp_footer', function () {
    if (is_admin()) return;
    ?>
<div id="zoo-payment-modal" style="display:none;">
  <div class="zoo-modal-inner">
    <h2>🦁 Pay with ZOO</h2>
    <div id="zooQR" class="zoo-qr-container"></div>
    <p class="zoo-qr-hint">Scan with Phantom Wallet</p>
    <div id="zoo-payment-info">
      <p>Wallet: <span id="zoo-wallet-address"></span></p>
      <p>Balance: <span id="zoo-balance"></span></p>
      <p>Total: <span id="zoo-order-total"></span></p>
    </div>
    <button type="button" id="zoo-confirm-payment">Pay From This Browser</button>
  </div>
</div>
<?php
});

// -------------------- Modal CSS --------------------
add_action('wp_enqueue_scripts', function () {
    if (is_admin()) return;
    wp_register_style('woo-zoo-modal', false, [], '1.0');
    wp_enqueue_style('woo-zoo-modal');
    wp_add_inline_style('woo-zoo-modal', '#zoo-payment-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:99999;}#zoo-payment-modal[style*="display:none"]{display:none!important;}.zoo-modal-inner{background:#0b0b0b;padding:40px;border-radius:12px;border:2px solid #00ffa3;box-shadow:0 0 25px #00ffa3;text-align:center;color:white;}.zoo-qr-container{min-height:220px;margin:15px 0;display:flex;align-items:center;justify-content:center;}.zoo-qr-hint{margin:0 0 15px;font-size:14px;color:#aaa;}#zoo-confirm-payment{background:#00ffa3;color:black;font-weight:bold;padding:12px 25px;border:none;border-radius:8px;cursor:pointer;}');
}, 15);

// -------------------- Create pending order (cron-based flow: order first, then TX, then server cron completes) --------------------
add_action('wp_ajax_zoo_create_pending_order', 'zoo_devnet_create_pending_order');
add_action('wp_ajax_nopriv_zoo_create_pending_order', 'zoo_devnet_create_pending_order');
function zoo_devnet_create_pending_order() {
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
        $order->set_payment_method('zoo_devnet');
        $order->set_payment_method_title('ZOO Token (Devnet)');
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
            'order_id'   => $order->get_id(),
            'order_key'  => $order->get_order_key(),
            'redirect'   => $order->get_checkout_order_received_url(),
            'redirect_url' => $order->get_checkout_order_received_url(),
        ]);
    } catch (Exception $e) {
        wp_send_json_error(['message' => $e->getMessage()]);
    }
}

// -------------------- Verify payment (JS sends order_id + tx after Phantom payment) --------------------
add_action('wp_ajax_zoo_verify_payment', 'zoo_devnet_verify_payment');
add_action('wp_ajax_nopriv_zoo_verify_payment', 'zoo_devnet_verify_payment');
function zoo_devnet_verify_payment() {
    $order_id = isset($_POST['order_id']) ? absint($_POST['order_id']) : 0;
    $tx = isset($_POST['tx']) ? sanitize_text_field(wp_unslash($_POST['tx'])) : (isset($_POST['tx_signature']) ? sanitize_text_field(wp_unslash($_POST['tx_signature'])) : '');

    if (!$order_id || !$tx) {
        wp_send_json_error(['message' => 'Missing order_id or tx']);
    }

    $order = wc_get_order($order_id);
    if (!$order) {
        wp_send_json_error(['message' => 'Order not found']);
    }
    if ($order->get_payment_method() !== 'zoo_devnet') {
        wp_send_json_error(['message' => 'Invalid payment method']);
    }
    if (!$order->has_status('pending')) {
        wp_send_json_success(['message' => 'Order already processed']);
    }

    $order->update_meta_data('_zoo_tx_signature', $tx);
    $order->update_meta_data('_zoo_tx_hash', $tx);
    $order->payment_complete();
    $order->save();

    wp_send_json_success(['redirect' => $order->get_checkout_order_received_url()]);
}

// -------------------- Cron confirmation: server calls this after on-chain verification --------------------
add_action('wp_ajax_wcs_confirm_zoo_payment', 'zoo_devnet_ajax_confirm_payment');
add_action('wp_ajax_nopriv_wcs_confirm_zoo_payment', 'zoo_devnet_ajax_confirm_payment');
function zoo_devnet_ajax_confirm_payment() {
    $order_id = isset($_POST['order_id']) ? absint($_POST['order_id']) : 0;
    $tx_signature = isset($_POST['tx_signature']) ? sanitize_text_field(wp_unslash($_POST['tx_signature'])) : '';

    if (!$order_id || !$tx_signature) {
        wp_send_json_error(['message' => 'Missing order_id or tx_signature']);
    }

    $order = wc_get_order($order_id);
    if (!$order) {
        wp_send_json_error(['message' => 'Order not found']);
    }
    if ($order->get_payment_method() !== 'zoo_devnet') {
        wp_send_json_error(['message' => 'Invalid payment method']);
    }
    if (!$order->has_status('pending')) {
        wp_send_json_success(['message' => 'Order already processed']);
    }

    $order->update_meta_data('_zoo_tx_signature', $tx_signature);
    $order->update_meta_data('_zoo_tx_hash', $tx_signature);
    $order->payment_complete();
    $order->save();

    wp_send_json_success(['redirect' => $order->get_checkout_order_received_url()]);
}

// Step 6 — Store transaction in WooCommerce order meta
add_action('woocommerce_checkout_update_order_meta', function ($order_id) {
    if (!empty($_POST['zoo_tx_hash'])) {
        $order = wc_get_order($order_id);
        if ($order) {
            $order->update_meta_data('_zoo_tx_hash', sanitize_text_field(wp_unslash($_POST['zoo_tx_hash'])));
            $order->update_meta_data('_zoo_tx_signature', sanitize_text_field(wp_unslash($_POST['zoo_tx_hash'])));
            $order->save();
        }
    }
});

// -------------------- Blue Degen Wallet Pill --------------------
add_action('wp_body_open', 'zoo_add_connect_wallet_button_devnet');
function zoo_add_connect_wallet_button_devnet() {
    if (is_admin()) return;
    ?>
    <div id="zoo-wallet-header" style="position:fixed; top:10px; right:10px; z-index:9999;">
        <button id="connect-wallet-btn" type="button" class="zoo-connect-pill" style="background:linear-gradient(90deg,#ff00ff,#00ffff); color:white; border-radius:20px; padding:10px 20px; font-size:16px; border:none; cursor:pointer; position:relative; overflow:hidden;">
            <span id="zoo-pill-dot" style="display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px;"></span>
            <span id="zoo-pill-text">Connect Wallet</span>
            <span id="zoo-balance-badge" style="margin-left:8px;"></span>
            <span id="zoo-gas-preview" style="margin-left:8px; font-size:12px; color:#0ff;"></span>
            <span id="zoo-tx-confirmed" style="position:absolute; top:-25px; left:50%; transform:translateX(-50%); color:#0f0; font-weight:bold; display:none;">TX CONFIRMED</span>
        </button>
    </div>
    <?php
}

// -------------------- WooCommerce Gateway --------------------
add_filter('woocommerce_payment_gateways', function ($gateways) {
    $gateways[] = 'WC_Gateway_Zoo_Devnet';
    return $gateways;
});

add_action('plugins_loaded', function () {
    if (!class_exists('WC_Payment_Gateway')) return;

    class WC_Gateway_Zoo_Devnet extends WC_Payment_Gateway {

        public function __construct() {
            $this->id = 'zoo_devnet';
            $this->method_title = 'ZOO Token (Devnet)';
            $this->method_description = 'Pay with ZOO Token on Solana Devnet.';
            $this->has_fields = true;

            $this->init_form_fields();
            $this->init_settings();

            $this->title = $this->get_option('title');
            $this->enabled = $this->get_option('enabled');

            add_action(
                'woocommerce_update_options_payment_gateways_' . $this->id,
                [$this, 'process_admin_options']
            );
        }

        public function init_form_fields() {
            $this->form_fields = [
                'enabled' => [
                    'title'   => 'Enable/Disable',
                    'type'    => 'checkbox',
                    'label'   => 'Enable ZOO Token (Devnet)',
                    'default' => 'yes'
                ],
                'title' => [
                    'title'       => 'Title',
                    'type'        => 'text',
                    'description' => 'Title shown at checkout',
                    'default'     => 'ZOO Token (Devnet)'
                ]
            ];
        }

        public function payment_fields() {
            echo '<input type="hidden" id="zoo_tx_hash" name="zoo_tx_hash" value="" />';
        }

        public function process_payment($order_id) {
            $tx = isset($_POST['zoo_tx_hash']) ? sanitize_text_field(wp_unslash($_POST['zoo_tx_hash'])) : '';
            if (!empty($tx)) {
                $order = wc_get_order($order_id);
                if ($order) {
                    $order->update_meta_data('_zoo_tx_signature', $tx);
                    $order->update_meta_data('_zoo_tx_hash', $tx);
                    $order->save();
                }
            }
            $order = wc_get_order($order_id);
            $redirect = $order ? $order->get_checkout_order_received_url() : wc_get_checkout_url();
            return [
                'result'   => 'success',
                'redirect' => $redirect
            ];
        }
    }
});
