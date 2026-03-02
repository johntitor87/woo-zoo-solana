# Payment flow: Square | ZOO Token

Two payment options only: **Square** (credit card) or **ZOO Token** (Solana).

---

## Flow

```
[Customer selects payment method] --> {Payment Option?}
{Payment Option?} -->|Square| [Square Gateway handles credit card payment]
[Square Gateway...] --> [Payment successful → WooCommerce marks order paid]

{Payment Option?} -->|ZOO Token| [Customer clicks "Pay with ZOO Token"]
[Customer clicks...] --> [Phantom Wallet pops up]
[Phantom Wallet pops up] --> {User approves transaction?}
{User approves?} -->|No / Cancel| [Checkout blocked, error message displayed]
{User approves?} -->|Yes| [ZOO token transfer initiated on Solana blockchain]
[ZOO token transfer...] --> [Transaction signature sent to Render API]
[Transaction signature...] --> {Render API verifies transaction?}
{Render API verifies?} -->|Failed| [Checkout blocked, error message displayed]
{Render API verifies?} -->|Verified| [WooCommerce completes checkout → Order Paid → Thank You Page]
```

---

## Explanation

1. **Payment selection**  
   Only two options: Square or ZOO Token.

2. **ZOO Token workflow**
   - Connects Phantom Wallet.
   - Sends the exact token amount (order total).
   - Sends transaction signature + order info to Render API.
   - API verifies: mint, amount, recipient wallet, and signature. Checkout completes only after verification.

3. **Checkout completion**  
   No premature redirect. WooCommerce completes checkout only after Render API returns verified/success.

4. **Failures (checkout blocked + error shown)**
   - Phantom cancellation or user rejection.
   - Insufficient ZOO balance or no ZOO token account.
   - Invalid transaction or Render API verification failure.

5. **Square payments**  
   Standard WooCommerce Square gateway; unchanged by this plugin.
