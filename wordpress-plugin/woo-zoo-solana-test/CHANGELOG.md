# Changelog

## 1.2.0 - 2026-04-13
- Refactored internal symbols and hooks from devnet-style names to mainnet naming while preserving backward compatibility.
- Added gateway id helpers and compatibility checks for legacy `zoo_devnet` orders/settings.
- Added gateway id localization to frontend checkout script and dual event binding for active + legacy checkout hooks.
- Added class alias compatibility (`WC_Gateway_Zoo_Mainnet` -> `WC_Gateway_Zoo_Devnet`) for older references.
- Updated plugin header version to 1.2.0.

## 1.1.0 - 2026-04-11
- Mainnet production hardening update.
- Updated checkout labels to remove user-facing "Devnet" wording.
- Added fallback filter to normalize saved gateway titles that still contain "Devnet".
- Added server-side order completion after successful Render verification to avoid pending-order race conditions.
- Added RPC override support via `ZOO_SOLANA_RPC_URL` (for Helius/QuickNode/Alchemy endpoints).
- Improved checkout UX by unlocking the WooCommerce form/button after Phantom flow to avoid requiring a second click.
- Packaged release includes `wp-config-snippet.txt` helper.

## 1.0.0
- Initial public release of ZOO SPL checkout flow.
