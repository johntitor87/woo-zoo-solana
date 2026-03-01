<?php
/**
 * Plugin Name: Woo ZOO Solana
 * Description: Full Phantom Wallet + ZOO Token integration for WooCommerce.
 * Version: 1.0
 * Author: Your Name
 */

if (!defined('ABSPATH')) exit;

// -------------------- Enqueue scripts --------------------
add_action('wp_enqueue_scripts', 'zoo_enqueue_wallet_scripts');
function zoo_enqueue_wallet_scripts() {
    if (!is_admin()) {
        // Solana web3.js
        wp_enqueue_script(
            'solana-web3',
            'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.73.0/lib/index.iife.min.js',
            [],
            '1.73.0',
            true
        );

        // Custom wallet script
        wp_enqueue_script(
            'zoo-wallet-js',
            plugins_url('wallet.js', __FILE__),
            ['jquery', 'solana-web3'],
            '1.0',
            true
        );

        // Localize script on checkout: ensure order_total and order_id are set so "not configured / order total zero" is avoided
        if (function_exists('is_checkout') && is_checkout()) {
            $order_total = 0;
            $order_id = 0;

            if (WC()->session) {
                $order_id = WC()->session->get('order_awaiting_payment');
            }
            // Order-pay page: get total from the order
            if (function_exists('is_wc_endpoint_url') && is_wc_endpoint_url('order-pay') && get_query_var('order-pay')) {
                $pay_order_id = absint(get_query_var('order-pay'));
                $pay_order = wc_get_order($pay_order_id);
                if ($pay_order) {
                    $order_id = $pay_order_id;
                    $order_total = (float) $pay_order->get_total();
                }
            }
            if ($order_id && $order_total <= 0) {
                $order = wc_get_order($order_id);
                if ($order) {
                    $order_total = (float) $order->get_total();
                }
            }
            if ($order_total <= 0 && WC()->cart) {
                $order_total = (float) WC()->cart->get_total('edit');
            }

            $zoo_settings = get_option('woocommerce_zoo_token_settings', []);
            $api_endpoint = !empty($zoo_settings['api_endpoint']) ? $zoo_settings['api_endpoint'] : 'https://your-render-api.com/verify-payment';

            wp_localize_script('zoo-wallet-js', 'zoo_ajax', [
                'order_id'     => $order_id,
                'order_amount' => $order_total,
                'api_endpoint' => $api_endpoint,
            ]);
        }
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

            // Initialize settings
            $this->init_form_fields();
            $this->init_settings();

            $this->enabled = $this->get_option('enabled', 'yes');
            $this->title = $this->get_option('title', 'ZOO Token');
            $this->description = $this->get_option('description', 'Pay securely with ZOO Tokens.');

            add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
            add_action('woocommerce_thankyou_' . $this->id, [$this, 'thankyou_page']);
        }

        public function is_available() {
            if ($this->enabled !== 'yes') {
                return false;
            }
            return parent::is_available();
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
                'description' => [
                    'title' => 'Description',
                    'type' => 'textarea',
                    'default' => 'Pay securely with ZOO Tokens via Phantom Wallet.'
                ],
                'api_endpoint' => [
                    'title' => 'Verification API endpoint',
                    'type' => 'text',
                    'description' => 'URL for payment verification (e.g. https://your-render-api.com/verify-payment). Required to avoid "ZOO payment is not configured".',
                    'default' => 'https://your-render-api.com/verify-payment'
                ],
            ];
        }

        public function payment_fields() {
            ?>
            <div id="zoo-checkout-wallet" style="margin:20px 0;">
                <button id="zoo-token-pay-btn" type="button">Pay with ZOO Token</button>
                <input type="hidden" id="zoo_wallet_address" name="zoo_wallet_address" value="" />
                <div id="zoo-wallet-display" style="margin-top:10px; font-weight:bold;"></div>
                <div id="zoo-wallet-msg" style="margin-top:5px;"></div>
            </div>
            <?php
        }

        public function validate_fields() {
            if (empty($_POST['zoo_wallet_address'])) {
                wc_add_notice('Please connect your Phantom Wallet before paying.', 'error');
                return false;
            }
            return true;
        }

        public function process_payment($order_id) {
            $order = wc_get_order($order_id);
            if (!$order) {
                wc_add_notice('Invalid order. Please try again.', 'error');
                return ['result' => 'failure', 'redirect' => ''];
            }

            // Save wallet address to order meta
            if (isset($_POST['zoo_wallet_address'])) {
                update_post_meta($order_id, '_zoo_wallet_address', sanitize_text_field($_POST['zoo_wallet_address']));
            }

            // Ensure order total is valid (fixes "order total is zero" from API)
            $order_amount = (float) $order->get_total();
            if ($order_amount <= 0) {
                wc_add_notice('Order total must be greater than zero. Please check your cart or contact support.', 'error');
                return ['result' => 'failure', 'redirect' => ''];
            }

            // Mark order as on-hold (payment pending)
            $order->update_status('on-hold', 'Awaiting ZOO Token payment');

            // Reduce stock
            wc_reduce_stock_levels($order_id);

            // Call API to verify payment
            $wallet_address = sanitize_text_field($_POST['zoo_wallet_address']);
            $api_endpoint = $this->get_option('api_endpoint', 'https://your-render-api.com/verify-payment');

            // Ensure API is configured (fixes "ZOO payment is not configured")
            if (empty($api_endpoint) || strpos($api_endpoint, 'your-render-api.com') !== false) {
                wc_add_notice('ZOO Token payment is not fully configured. Please set the Verification API endpoint in WooCommerce → Settings → Payments → ZOO Token.', 'error');
                return ['result' => 'failure', 'redirect' => ''];
            }

            $response = wp_remote_post($api_endpoint, [
                'method'    => 'POST',
                'body'      => wp_json_encode([
                    'wallet_address' => $wallet_address,
                    'order_amount'   => $order_amount,
                    'order_id'       => $order_id,
                ]),
                'headers'   => [
                    'Content-Type' => 'application/json',
                ],
            ]);

            if (is_wp_error($response)) {
                $error_message = $response->get_error_message();
                wc_add_notice('Payment verification failed: ' . esc_html($error_message), 'error');
                return [
                    'result' => 'failure',
                    'redirect' => ''
                ];
            }

            $response_data = json_decode(wp_remote_retrieve_body($response), true);

            if (is_array($response_data) && isset($response_data['status']) && $response_data['status'] === 'success') {
                $order->payment_complete();
                $order->add_order_note('Payment successfully verified via ZOO Token.');

                WC()->cart->empty_cart();

                return [
                    'result'   => 'success',
                    'redirect' => $this->get_return_url($order)
                ];
            }

            wc_add_notice('Payment verification failed. Please try again or contact support.', 'error');
            return [
                'result' => 'failure',
                'redirect' => ''
            ];
        }

        public function thankyou_page($order_id) {
            $wallet = get_post_meta($order_id, '_zoo_wallet_address', true);
            if ($wallet) {
                echo '<p><strong>Your ZOO Wallet used for this order:</strong> ' . esc_html($wallet) . '</p>';
            }
        }
    }
}

// -------------------- Old ZOO Solana Connect Wallet tab (gradient pill, fixed top-right) --------------------
add_action('wp_head', 'zoo_add_header_wallet_button');
function zoo_add_header_wallet_button() {
    ?>
    <div id="zoo-wallet-header" style="position:fixed; top:10px; right:10px; z-index:9999; display:inline-flex; align-items:center; gap:0.5rem;">
        <button id="connect-wallet-btn" type="button" style="display:inline-flex; align-items:center; justify-content:center; padding:0.5rem 1rem; font-size:0.875rem; font-weight:600; line-height:1.25; border-radius:9999px; border:none; cursor:pointer; background:linear-gradient(135deg, #9945ff 0%, #14f195 100%); color:#0d0d0d; box-shadow:0 2px 8px rgba(153,69,255,0.35); white-space:nowrap;">Connect Wallet</button>
        <span id="zoo-wallet-msg" style="margin-left:4px; font-size:0.875rem;"></span>
    </div>
    <?php
}

// -------------------- Add Checkout Button & Wallet Display (commented out) --------------------
// add_action('woocommerce_review_order_before_payment', 'zoo_add_checkout_wallet');
// function zoo_add_checkout_wallet() {
//     ?>
//     <div id="zoo-checkout-wallet" style="margin:20px 0;">
//         <button id="zoo-token-pay-btn" type="button">Pay with ZOO Token</button>
//         <input type="hidden" id="zoo_wallet_address" name="zoo_wallet_address" value="" />
//         <div id="zoo-wallet-display" style="margin-top:10px; font-weight:bold;"></div>
//     </div>
//     <?php
// }

// -------------------- Save Wallet Address to Order Meta --------------------
add_action('woocommerce_checkout_update_order_meta', 'zoo_save_wallet_address');
function zoo_save_wallet_address($order_id) {
    if (isset($_POST['zoo_wallet_address']) && !empty($_POST['zoo_wallet_address'])) {
        update_post_meta($order_id, '_zoo_wallet_address', sanitize_text_field($_POST['zoo_wallet_address']));
    }
}

// -------------------- Display Wallet on Thank You Page --------------------
add_action('woocommerce_thankyou', 'zoo_display_wallet_thankyou', 20);
function zoo_display_wallet_thankyou($order_id) {
    $wallet = get_post_meta($order_id, '_zoo_wallet_address', true);
    if ($wallet) {
        echo '<p><strong>Your ZOO Wallet used for this order:</strong> ' . esc_html($wallet) . '</p>';
    }
}
