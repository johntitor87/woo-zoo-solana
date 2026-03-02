<?php
/**
 * Plugin Name: ZOO Solana WooCommerce
 * Plugin URI: https://github.com/your-org/fulcanellie
 * Description: Solana staking gating for WooCommerce — wallet connection, stake checks, product gating, checkout validation, tiered discounts.
 * Version: 1.0.0
 * Author: ZOO
 * Author URI: https://lionsinthezoo.com
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: zoo-solana-woocommerce
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * WC requires at least: 5.0
 * WC tested up to: 8.0
 */

defined('ABSPATH') || exit;

define('ZOO_SOLANA_WC_VERSION', '1.0.0');
define('ZOO_SOLANA_WC_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('ZOO_SOLANA_WC_PLUGIN_URL', plugin_dir_url(__FILE__));

/**
 * Check WooCommerce is active
 */
function zoo_solana_wc_check_woocommerce() {
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', function () {
            echo '<div class="error"><p><strong>ZOO Solana WooCommerce</strong> requires WooCommerce to be installed and active.</p></div>';
        });
        return false;
    }
    return true;
}

/**
 * Get staking API base URL from settings (no trailing slash)
 */
function zoo_solana_wc_api_url() {
    return rtrim(get_option('zoo_staking_api_url', 'http://localhost:3001'), '/');
}

/**
 * Get user's wallet address (session for guests, user meta for logged-in)
 */
function zoo_get_user_wallet() {
    if (is_user_logged_in()) {
        $meta = get_user_meta(get_current_user_id(), 'zoo_wallet_address', true);
        if ($meta) {
            return $meta;
        }
    }
    if (isset($_COOKIE['zoo_wallet_address']) && is_string($_COOKIE['zoo_wallet_address'])) {
        return sanitize_text_field(wp_unslash($_COOKIE['zoo_wallet_address']));
    }
    return '';
}

/**
 * Fetch stake status from API (camelCase from Node API)
 */
function zoo_get_stake_status($wallet_address) {
    if (empty($wallet_address)) {
        return null;
    }
    $api_url = zoo_solana_wc_api_url() . '/api/staking/status?user_address=' . urlencode($wallet_address);
    $response = wp_remote_get($api_url, array('timeout' => 15));
    if (is_wp_error($response)) {
        return null;
    }
    $code = wp_remote_retrieve_response_code($response);
    if ($code !== 200) {
        return null;
    }
    $body = wp_remote_retrieve_body($response);
    $data = json_decode($body, true);
    if (empty($data['success']) || empty($data['status'])) {
        return null;
    }
    return $data['status'];
}

/**
 * Product is gated (Tier 2+ required)
 */
function zoo_is_gated_product($product_id) {
    return get_post_meta($product_id, '_zoo_gated', true) === 'yes';
}

/**
 * Product is exclusive (Tier 3 only)
 */
function zoo_is_exclusive_product($product_id) {
    return get_post_meta($product_id, '_zoo_exclusive', true) === 'yes';
}

// --- WooCommerce hooks ---

add_filter('woocommerce_product_is_visible', 'zoo_check_product_visibility', 10, 2);
function zoo_check_product_visibility($visible, $product_id) {
    $wallet = zoo_get_user_wallet();
    if (!$wallet) {
        if (zoo_is_gated_product($product_id)) {
            return false;
        }
        return $visible;
    }
    $status = zoo_get_stake_status($wallet);
    $can_see = isset($status['canSeeProducts']) ? $status['canSeeProducts'] : ($status['can_see_products'] ?? false);
    if (!$can_see && zoo_is_gated_product($product_id)) {
        return false;
    }
    return $visible;
}

add_filter('woocommerce_product_is_visible', 'zoo_check_exclusive_access', 20, 2);
function zoo_check_exclusive_access($visible, $product_id) {
    if (!zoo_is_exclusive_product($product_id)) {
        return $visible;
    }
    $wallet = zoo_get_user_wallet();
    if (!$wallet) {
        return false;
    }
    $status = zoo_get_stake_status($wallet);
    $exclusive = isset($status['hasExclusiveAccess']) ? $status['hasExclusiveAccess'] : ($status['has_exclusive_access'] ?? false);
    return $exclusive ? $visible : false;
}

// Only require wallet when paying with ZOO Token; no staking required to checkout.
add_action('woocommerce_checkout_process', 'zoo_validate_checkout_permission');
function zoo_validate_checkout_permission() {
    $chosen = isset($_POST['payment_method']) ? sanitize_text_field(wp_unslash($_POST['payment_method'])) : '';
    if ($chosen !== 'zoo_token') {
        return;
    }
    $wallet = zoo_get_user_wallet();
    if (!$wallet) {
        wc_add_notice(__('Please connect your Solana wallet to pay with ZOO Token.', 'zoo-solana-woocommerce'), 'error');
    }
}

// ZOO Token payment: flat 20% off for everyone; extra % off for staking tiers (only when paying with ZOO).
add_action('woocommerce_cart_calculate_fees', 'zoo_apply_zoo_payment_discounts');
function zoo_apply_zoo_payment_discounts() {
    $chosen = WC()->session ? WC()->session->get('chosen_payment_method') : '';
    if ($chosen !== 'zoo_token') {
        return;
    }
    $subtotal = (float) WC()->cart->get_subtotal();
    if ($subtotal <= 0) {
        return;
    }

    $zoo_flat_pct = 20;
    $flat_discount = $subtotal * ($zoo_flat_pct / 100);
    WC()->cart->add_fee(
        sprintf(__('ZOO Token discount (%d%%)', 'zoo-solana-woocommerce'), $zoo_flat_pct),
        -$flat_discount
    );

    $wallet = zoo_get_user_wallet();
    if ($wallet) {
        $status = zoo_get_stake_status($wallet);
        if ($status) {
            $pct = isset($status['discountPercent']) ? (float) $status['discountPercent'] : (float) ($status['discount_percent'] ?? 0);
            if ($pct > 0) {
                $tier = isset($status['tier']) ? (int) $status['tier'] : 0;
                $tier_discount = $subtotal * ($pct / 100);
                WC()->cart->add_fee(
                    sprintf(__('Staking tier discount (Tier %d, %s%%)', 'zoo-solana-woocommerce'), $tier, number_format($pct, 0)),
                    -$tier_discount
                );
            }
        }
    }
}

// --- Settings ---
add_action('admin_menu', 'zoo_solana_wc_settings_menu');
function zoo_solana_wc_settings_menu() {
    add_options_page(
        __('ZOO Solana WooCommerce', 'zoo-solana-woocommerce'),
        __('ZOO Staking', 'zoo-solana-woocommerce'),
        'manage_options',
        'zoo-solana-woocommerce',
        'zoo_solana_wc_settings_page'
    );
}

add_action('plugins_loaded', function () {
    if (!class_exists('WooCommerce')) {
        return;
    }
    require_once ZOO_SOLANA_WC_PLUGIN_DIR . 'includes/class-wc-gateway-zoo-token.php';
}, 21);

add_filter('woocommerce_payment_gateways', function ($gateways) {
    $gateways[] = 'WC_Gateway_ZOO_Token';
    return $gateways;
});

add_action('admin_init', 'zoo_solana_wc_register_settings');
function zoo_solana_wc_register_settings() {
    register_setting('zoo_solana_wc', 'zoo_staking_api_url', array(
        'type' => 'string',
        'sanitize_callback' => 'esc_url_raw',
    ));
}

function zoo_solana_wc_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $api_url = get_option('zoo_staking_api_url', 'http://localhost:3001');
    ?>
    <div class="wrap">
        <h1><?php echo esc_html(get_admin_page_title()); ?></h1>
        <form action="options.php" method="post">
            <?php settings_fields('zoo_solana_wc'); ?>
            <table class="form-table">
                <tr>
                    <th scope="row"><label for="zoo_staking_api_url"><?php esc_html_e('Staking API URL', 'zoo-solana-woocommerce'); ?></label></th>
                    <td>
                        <input type="url" id="zoo_staking_api_url" name="zoo_staking_api_url" value="<?php echo esc_attr($api_url); ?>" class="regular-text" />
                        <p class="description"><?php esc_html_e('Base URL of your staking API (e.g. http://localhost:3001 or https://api.yoursite.com). Must expose /api/staking/status?user_address=...', 'zoo-solana-woocommerce'); ?></p>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

// --- Product meta (gated / exclusive) ---
add_action('woocommerce_product_options_general_product_data', 'zoo_product_zoo_options');
function zoo_product_zoo_options() {
    global $post;
    echo '<div class="options_group">';
    woocommerce_wp_checkbox(array(
        'id' => '_zoo_gated',
        'label' => __('ZOO gated (Tier 2+)', 'zoo-solana-woocommerce'),
        'description' => __('Require at least 500 ZOO staked to see this product.', 'zoo-solana-woocommerce'),
    ));
    woocommerce_wp_checkbox(array(
        'id' => '_zoo_exclusive',
        'label' => __('ZOO exclusive (Tier 3)', 'zoo-solana-woocommerce'),
        'description' => __('Require 1000+ ZOO staked to see this product.', 'zoo-solana-woocommerce'),
    ));
    echo '</div>';
}

add_action('woocommerce_process_product_meta', 'zoo_save_product_zoo_options');
function zoo_save_product_zoo_options($post_id) {
    $gated = isset($_POST['_zoo_gated']) ? 'yes' : 'no';
    $exclusive = isset($_POST['_zoo_exclusive']) ? 'yes' : 'no';
    update_post_meta($post_id, '_zoo_gated', $gated);
    update_post_meta($post_id, '_zoo_exclusive', $exclusive);
}

// --- Enqueue wallet script + styles (header + shortcode) ---
add_action('wp_enqueue_scripts', 'zoo_solana_wc_front_scripts');
function zoo_solana_wc_front_scripts() {
    if (is_admin()) {
        return;
    }
    wp_register_script(
        'zoo-solana-wallet',
        ZOO_SOLANA_WC_PLUGIN_URL . 'assets/js/wallet.js',
        array(),
        ZOO_SOLANA_WC_VERSION,
        true
    );
    wp_localize_script('zoo-solana-wallet', 'zooStakingApi', array(
        'apiUrl' => zoo_solana_wc_api_url(),
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('zoo_wallet_nonce'),
    ));
    wp_register_style(
        'zoo-solana-wallet',
        ZOO_SOLANA_WC_PLUGIN_URL . 'assets/css/wallet.css',
        array(),
        ZOO_SOLANA_WC_VERSION
    );
}

// ZOO Solana Checkout: load Solana web3 + checkout script on WooCommerce checkout.
add_action('wp_enqueue_scripts', 'zoo_solana_checkout_scripts', 20);
function zoo_solana_checkout_scripts() {
    if (is_admin()) {
        return;
    }
    if (!function_exists('is_checkout') || !is_checkout()) {
        return;
    }
    wp_enqueue_script(
        'solana-phantom',
        'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.95.4/lib/index.iife.min.js',
        array(),
        '1.95.4',
        true
    );
    wp_enqueue_script(
        'zoo-checkout',
        ZOO_SOLANA_WC_PLUGIN_URL . 'assets/js/zoo-checkout-phantom.js',
        array('solana-phantom'),
        ZOO_SOLANA_WC_VERSION,
        true
    );
}

/**
 * Render wallet connect UI for header (same DOM structure as shortcode so wallet.js works).
 * Use do_action('zoo_solana_wallet_header') in theme header, or it appears in nav menu via filter below.
 */
function zoo_header_wallet_html() {
    wp_enqueue_script('zoo-solana-wallet');
    wp_enqueue_style('zoo-solana-wallet');
    $wallet = zoo_get_user_wallet();
    ob_start();
    ?>
    <div id="zoo-wallet-connect" class="zoo-wallet-box zoo-wallet-in-header">
        <?php if ($wallet) : ?>
            <span class="zoo-wallet-connected">
                <span class="zoo-wallet-address" title="<?php echo esc_attr($wallet); ?>"><?php echo esc_html(substr($wallet, 0, 4) . '…' . substr($wallet, -4)); ?></span>
                <button type="button" class="zoo-wallet-btn zoo-wallet-disconnect" aria-label="<?php esc_attr_e('Disconnect wallet', 'zoo-solana-woocommerce'); ?>"><?php esc_html_e('Disconnect', 'zoo-solana-woocommerce'); ?></button>
            </span>
        <?php else : ?>
            <span class="zoo-wallet-chooser">
                <button type="button" class="zoo-wallet-btn zoo-wallet-connect zoo-wallet-connect-primary"><?php esc_html_e('Connect Wallet', 'zoo-solana-woocommerce'); ?></button>
            </span>
        <?php endif; ?>
        <p class="zoo-wallet-error" style="display:none;"></p>
    </div>
    <?php
    return ob_get_clean();
}

/**
 * Add Connect Wallet to primary nav menu — DISABLED so only Woo ZOO Solana blue pill (right) shows.
 * To re-enable the left-side menu item, uncomment the add_filter and function below.
 */
// add_filter('wp_nav_menu_items', 'zoo_nav_menu_add_wallet', 10, 2);
// function zoo_nav_menu_add_wallet($items, $args) {
//     $locations = array('primary', 'main', 'header', 'primary-menu', 'menu-primary');
//     if (!isset($args->theme_location) || !in_array($args->theme_location, $locations, true)) {
//         return $items;
//     }
//     $items .= '<li class="menu-item zoo-wallet-nav-item">' . zoo_header_wallet_html() . '</li>';
//     return $items;
// }

/**
 * Theme hook: use in header template with <?php do_action('zoo_solana_wallet_header'); ?>
 */
add_action('zoo_solana_wallet_header', function () {
    echo zoo_header_wallet_html();
});

add_action('wp_ajax_zoo_save_wallet', 'zoo_ajax_save_wallet');
add_action('wp_ajax_nopriv_zoo_save_wallet', 'zoo_ajax_save_wallet');
function zoo_ajax_save_wallet() {
    check_ajax_referer('zoo_wallet_nonce', 'nonce');
    $address = isset($_POST['wallet_address']) ? sanitize_text_field(wp_unslash($_POST['wallet_address'])) : '';
    if (!empty($address) && (strlen($address) < 32 || strlen($address) > 64)) {
        wp_send_json_error(array('message' => 'Invalid address'));
    }
    if (is_user_logged_in()) {
        update_user_meta(get_current_user_id(), 'zoo_wallet_address', $address ?: '');
    }
    if ($address) {
        setcookie('zoo_wallet_address', $address, time() + (30 * DAY_IN_SECONDS), '/', '', is_ssl(), true);
    } else {
        setcookie('zoo_wallet_address', '', time() - 3600, '/', '', is_ssl(), true);
    }
    wp_send_json_success(array('saved' => true));
}

// Shortcode: [zoo_connect_wallet]
add_shortcode('zoo_connect_wallet', 'zoo_connect_wallet_shortcode');
function zoo_connect_wallet_shortcode() {
    wp_enqueue_script('zoo-solana-wallet');
    $wallet = zoo_get_user_wallet();
    ob_start();
    ?>
    <div id="zoo-wallet-connect-shortcode" class="zoo-wallet-box">
        <?php if ($wallet) : ?>
            <p class="zoo-wallet-connected">
                <span class="zoo-wallet-label"><?php esc_html_e('Connected:', 'zoo-solana-woocommerce'); ?></span>
                <code class="zoo-wallet-address"><?php echo esc_html(substr($wallet, 0, 8) . '…' . substr($wallet, -8)); ?></code>
                <button type="button" class="button zoo-wallet-disconnect"><?php esc_html_e('Disconnect', 'zoo-solana-woocommerce'); ?></button>
            </p>
        <?php else : ?>
            <p>
                <span class="zoo-wallet-chooser">
                    <button type="button" class="button button-primary zoo-wallet-connect"><?php esc_html_e('Connect Wallet', 'zoo-solana-woocommerce'); ?></button>
                </span>
            </p>
            <p class="zoo-wallet-hint"><?php esc_html_e('Solana wallets: Phantom, Solflare, Backpack, OKX, or Coinbase Wallet.', 'zoo-solana-woocommerce'); ?></p>
        <?php endif; ?>
        <p class="zoo-wallet-error" style="display:none;"></p>
    </div>
    <?php
    return ob_get_clean();
}

// Shortcode: [zoo_pay_button order_id="1234" amount="10" text="Pay 10 ZOO Tokens"]
add_shortcode('zoo_pay_button', 'zoo_pay_button_shortcode');
function zoo_pay_button_shortcode($atts) {
    $atts = shortcode_atts(array(
        'order_id' => '',
        'amount'   => '',
        'text'     => '',
    ), $atts, 'zoo_pay_button');

    $order_id = absint($atts['order_id']);
    $amount   = $atts['amount'] !== '' ? floatval($atts['amount']) : 0;
    $text     = $atts['text'] !== '' ? $atts['text'] : sprintf(__('Pay %s ZOO Tokens', 'zoo-solana-woocommerce'), number_format($amount, 2));

    if (!$order_id || $amount <= 0) {
        return '<!-- zoo_pay_button: set order_id and amount -->';
    }

    $settings = get_option('woocommerce_zoo_token_settings', array());
    $api_url  = isset($settings['zoo_checkout_api_url']) ? rtrim($settings['zoo_checkout_api_url'], '/') : '';
    if (!$api_url) {
        return '<!-- zoo_pay_button: set ZOO Checkout API URL in WooCommerce → Payments → ZOO Token -->';
    }

    wp_enqueue_script('solana-web3', 'https://unpkg.com/@solana/web3.js@1.95.4/lib/index.iife.min.js', array(), '1.95.4', true);
    wp_enqueue_script(
        'zoo-checkout-phantom',
        ZOO_SOLANA_WC_PLUGIN_URL . 'assets/js/zoo-checkout-phantom.js',
        array('solana-web3'),
        ZOO_SOLANA_WC_VERSION,
        true
    );
    wp_localize_script('zoo-checkout-phantom', 'zooCheckoutApi', array(
        'orderId'          => (string) $order_id,
        'amount'           => $amount,
        'apiUrl'           => $api_url,
        'orderReceivedUrl' => wc_get_endpoint_url('order-received', '', wc_get_checkout_url()),
    ));

    return sprintf(
        '<button type="button" class="button zoo-pay-token-btn" onclick="payWithZooToken(%d, %s)">%s</button>',
        $order_id,
        esc_attr($amount),
        esc_html($text)
    );
}
