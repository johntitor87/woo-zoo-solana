<?php
/**
 * ZOO Token payment gateway.
 *
 * Payment options: Square | ZOO Token only. Square uses standard WooCommerce Square gateway.
 * ZOO flow: Customer clicks "Pay with ZOO Token" → Phantom pops up → user approves →
 * ZOO transfer on Solana → tx signature sent to Render API → API verifies mint, amount,
 * recipient wallet, signature → only then WooCommerce completes checkout (no premature redirect).
 * Failures block checkout and show an error.
 */
if (!defined('ABSPATH')) exit;

class WC_Gateway_ZOO extends WC_Payment_Gateway {

    public function __construct() {
        $this->id = 'zoo_token';
        $this->method_title = 'ZOO Token';
        $this->has_fields = true;

        $this->init_form_fields();
        $this->init_settings();
        $this->title = $this->get_option('title');

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
        add_action('woocommerce_thankyou_' . $this->id, [$this, 'thankyou_page']);

        add_action('wp_ajax_wcs_confirm_zoo_payment', [$this, 'ajax_confirm_payment']);
        add_action('wp_ajax_nopriv_wcs_confirm_zoo_payment', [$this, 'ajax_confirm_payment']);
    }

    public function init_form_fields() {
        $this->form_fields = [
            'enabled' => [
                'title'   => 'Enable/Disable',
                'type'    => 'checkbox',
                'default' => 'yes',
            ],
            'title' => [
                'title'   => 'Title',
                'type'    => 'text',
                'default' => 'Pay with ZOO Token',
            ],
            'api_endpoint' => [
                'title'       => 'Render API URL',
                'type'        => 'text',
                'description' => 'Base URL of your ZOO checkout API (e.g. https://zoo-solana-checkout-api-1.onrender.com)',
                'default'     => 'https://zoo-solana-checkout-api-1.onrender.com',
            ],
            'zoo_mint' => [
                'title'       => 'ZOO Token Mint',
                'type'        => 'text',
                'description' => 'ZOO token mint address (9 decimals). Default is the official ZOO mint.',
                'default'     => 'FKkgeZxYLxoZ1WciErXKbeNTf5CB296zv51euCR7MZN3',
            ],
            'shop_wallet' => [
                'title'       => 'Shop Wallet (YOUR_ZOO_WALLET_PUBLIC_KEY)',
                'type'        => 'text',
                'description' => 'Your Solana wallet address that receives ZOO payments (e.g. your Phantom wallet public key). Required.',
            ],
            'rpc_url' => [
                'title'   => 'Solana RPC URL',
                'type'    => 'text',
                'default' => 'https://api.mainnet-beta.solana.com',
            ],
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

    public function process_payment($order_id) {
        $order = wc_get_order($order_id);

        $tx_signature = isset($_POST['zoo_tx_signature']) ? sanitize_text_field(wp_unslash($_POST['zoo_tx_signature'])) : '';
        $wallet = isset($_POST['zoo_wallet']) ? sanitize_text_field(wp_unslash($_POST['zoo_wallet'])) : '';

        if (!empty($tx_signature) && !empty($wallet)) {
            $amount = (float) $order->get_total();
            $api_base = rtrim($this->get_option('api_endpoint', ''), '/');
            $pay_url = $api_base . '/pay';

            $response = wp_remote_post($pay_url, [
                'headers' => ['Content-Type' => 'application/json'],
                'body'    => wp_json_encode([
                    'wallet'      => $wallet,
                    'amount'      => $amount,
                    'txSignature' => $tx_signature,
                ]),
                'timeout' => 20,
            ]);

            if (!is_wp_error($response)) {
                $body = json_decode(wp_remote_retrieve_body($response), true);
                if (!empty($body['success'])) {
                    $order->update_meta_data('_zoo_tx_signature', $tx_signature);
                    $order->update_meta_data('_zoo_tx_hash', $tx_signature);
                    $order->update_meta_data('_zoo_wallet', $wallet);
                    $order->payment_complete();
                    $order->save();
                    return [
                        'result'   => 'success',
                        'redirect' => $this->get_return_url($order),
                    ];
                }
            }

            $order->update_status('failed', __('ZOO payment verification failed.', 'woo-zoo-solana'));
            return [
                'result'   => 'failure',
                'messages' => __('Payment verification failed. Please try again.', 'woo-zoo-solana'),
            ];
        }

        $order->update_status('on-hold', __('Awaiting ZOO token payment verification.', 'woo-zoo-solana'));
        return [
            'result'   => 'success',
            'redirect' => $order->get_checkout_payment_url(true),
        ];
    }

    public function ajax_confirm_payment() {
        $order_id = isset($_POST['order_id']) ? absint($_POST['order_id']) : 0;
        $order_key = isset($_POST['order_key']) ? sanitize_text_field(wp_unslash($_POST['order_key'])) : '';
        $tx_signature = isset($_POST['tx_signature']) ? sanitize_text_field(wp_unslash($_POST['tx_signature'])) : '';
        $wallet = isset($_POST['wallet']) ? sanitize_text_field(wp_unslash($_POST['wallet'])) : '';

        if (!$order_id || !$order_key || !$tx_signature || !$wallet) {
            wp_send_json_error(['message' => 'Missing parameters']);
        }

        $order = wc_get_order($order_id);
        if (!$order || $order->get_order_key() !== $order_key) {
            wp_send_json_error(['message' => 'Invalid order']);
        }

        $amount = (float) $order->get_total();
        $api_base = rtrim($this->get_option('api_endpoint', ''), '/');
        $pay_url = $api_base . '/pay';

        $response = wp_remote_post($pay_url, [
            'headers' => ['Content-Type' => 'application/json'],
            'body'    => wp_json_encode([
                'wallet'      => $wallet,
                'amount'      => $amount,
                'txSignature' => $tx_signature,
            ]),
            'timeout' => 20,
        ]);

        if (is_wp_error($response)) {
            wp_send_json_error(['message' => $response->get_error_message()]);
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        if (empty($body['success'])) {
            wp_send_json_error(['message' => isset($body['error']) ? $body['error'] : 'Verification failed']);
        }

        $order->update_meta_data('_zoo_tx_signature', $tx_signature);
        $order->update_meta_data('_zoo_tx_hash', $tx_signature);
        $order->update_meta_data('_zoo_wallet', $wallet);
        $order->payment_complete();
        $order->save();

        wp_send_json_success([
            'redirect' => $this->get_return_url($order),
        ]);
    }

    public function thankyou_page($order_id) {
        echo '<p>' . esc_html__('Your ZOO Token payment has been confirmed. Thank you!', 'woo-zoo-solana') . '</p>';
    }
}
