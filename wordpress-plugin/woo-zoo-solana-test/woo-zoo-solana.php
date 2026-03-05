<?php
/**
 * Plugin Name: Woo ZOO Solana Devnet
 * Description: Test version for ZOO Token on devnet. Flashy degen wallet pill, Phantom integration, animations.
 * Version: 1.0
 * Author: Your Name
 */

if (!defined('ABSPATH')) exit;

// -------------------- Enqueue Scripts --------------------
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

    wp_enqueue_script(
        'solana-web3',
        'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.73.0/lib/index.iife.min.js',
        [],
        '1.73.0',
        true
    );

    wp_enqueue_script(
        'zoo-wallet-js-devnet',
        plugins_url('wallet-devnet.js', __FILE__),
        ['jquery', 'solana-web3'],
        '1.0',
        true
    );

    // Localize for checkout
    if (function_exists('is_checkout') && is_checkout() && function_exists('WC') && WC()) {
        $order_total = 0;
        $order_id = 0;
        if (WC()->session) $order_id = WC()->session->get('order_awaiting_payment');
        if (WC()->cart) $order_total = (float) WC()->cart->get_total('edit');

        wp_localize_script('zoo-wallet-js-devnet', 'zoo_ajax', [
            'order_id' => $order_id,
            'order_amount' => $order_total,
            'api_endpoint' => 'https://woo-solana-payment-devnet.onrender.com/verify-devnet-payment',
            'shop_wallet' => 'AVJqhvECgwFkMQbmmTinbf4DxPco6fhzWEpzWyGi53xa',
            'rpc_url' => 'https://api.devnet.solana.com',
            'zoo_mint' => 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3',
            'ajax_url' => admin_url('admin-ajax.php'),
            'create_order_nonce' => wp_create_nonce('zoo_create_pending_order'),
            'decimals' => 9,
        ]);
    } else {
        wp_localize_script('zoo-wallet-js-devnet', 'zoo_ajax', [
            'order_id' => 0,
            'order_amount' => 0,
            'api_endpoint' => 'https://woo-solana-payment-devnet.onrender.com/verify-devnet-payment',
            'shop_wallet' => 'AVJqhvECgwFkMQbmmTinbf4DxPco6fhzWEpzWyGi53xa',
            'rpc_url' => 'https://api.devnet.solana.com',
            'zoo_mint' => 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3',
            'ajax_url' => admin_url('admin-ajax.php'),
            'create_order_nonce' => '',
            'decimals' => 9,
        ]);
    }
}

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
            $this->has_fields = false;

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

        public function process_payment($order_id) {
            return [
                'result' => 'success'
            ];
        }
    }
});
