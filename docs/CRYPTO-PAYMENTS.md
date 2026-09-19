# Crypto payments (direct-to-wallet Solana checkout)

Achiote accepts SOL and USDC for the four live retail tiers with **no Stripe and no
custodial payment account**: the server knows only a PUBLIC receive address and credits
orders by verifying on-chain transfers through the public Solana JSON-RPC. The server
never holds, sees, or generates private keys of any kind. Funds move buyer-wallet →
org-wallet directly.

## Go live: one env var

```
ACHIOTE_CRYPTO_SOL_ADDRESS=<base58 receive address of the org wallet>
```

Everything else has defaults. Until this is set, every crypto endpoint answers
`503 {"error":"Crypto payments not configured"}`, `/health` reports `cryptoEnabled: false`,
and the landing page keeps its crypto links hidden — the feature is dark.

Two optional knobs:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACHIOTE_CRYPTO_USDC_MINT` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (mainnet USDC) | Which SPL token counts as USDC |
| `ACHIOTE_CRYPTO_RPC_URL` | `https://api.mainnet-beta.solana.com` | Solana JSON-RPC endpoint (point at a paid RPC for volume) |

`ACHIOTE_KEY_ENCRYPTION_KEY` (the same 64-hex material Stripe billing uses) must also be
set: API-key handoff encrypts keys with it. Without it crypto stays unconfigured rather
than taking payments it could never fulfill.

## Flow

1. `POST /billing/crypto-order {tier, mode, asset}` — validates tier/mode against the same
   tables as Stripe checkout (`personal`/`family` subscriptions; `memory-pack`/
   `family-sprint` one-time payments; annual billing is Stripe-only). Amount:
   - **USDC** = USD price at exact 1:1, 6 decimals (e.g. $9 → `9.000000` base units ×10⁶).
   - **SOL** = USD price / spot, quoted server-side from Jupiter's public price API
     (`lite-api.jup.ag/price/v3`, 60 s cache, round-half-up to lamports). If the quote
     fails, SOL orders return `503 quote-unavailable` while USDC keeps working.
   Returns `{ref, asset, address, amount, uri, expiresAtMs}`. `ref` is an 8-char code from
   an unambiguous charset (no `0/O/1/I`); `uri` is a Solana Pay URI
   `solana:<address>?amount=<ui>[&spl-token=<mint>]&label=Achiote&memo=<ref>`
   (SOL amounts are UI units = lamports/10⁹, USDC = base units/10⁶). Orders expire after
   60 minutes.
2. The landing page shows a QR of the URI (`docs/landing/vendor/qrcode.js`, a vendored
   MIT `qrcode-generator` — self-hosted, CSP stays `'self'`), plus address/amount/ref copy
   buttons and an "I have sent the payment" poller (5 s interval until expiry).
3. A server-side poller (`setInterval` 20 s, `unref`'d, only queries RPC while pending
   orders exist) watches `getSignaturesForAddress` on the receive address (SOL) and on the
   USDC token accounts owned by it (found via `getTokenAccountsByOwner` — SPL transfers
   land in the ATA, and Solana Pay wallets create the recipient ATA when missing). New
   signatures → `getTransaction` (`json`, `maxSupportedTransactionVersion: 0`) →
   deterministic match rules below. RPC 429/5xx errors retry with exponential backoff,
   max 5 attempts.
4. `GET /billing/crypto-status?ref=...` → `{status: pending|paid|expired}` (+ `sessionId`
   when paid). On paid the frontend redirects to
   `/billing/success?session_id=crypto:<ref>`, which hands over the API key exactly like
   the Stripe success page (one-time display).

## Verification rules (deterministic)

A payment credits an order when a transfer **to a watched account of ours** satisfies:

- **Memo rule**: any memo instruction in the transaction contains the order's `ref`, and
  the transaction also carries a transfer of that order's asset to our address/token
  account. Wallets embed the ref because the Solana Pay URI carries it as `memo`.
- **Amount rule** (when no memo matched): an exact-amount transfer of the right asset to a
  watched account, with chain `blockTime` inside the order window (created … +60 min,
  ±5 min clock slack). When two pending orders could claim one transfer, the oldest wins;
  one transfer credits at most one order.

Transfers to other addresses, failed transactions, wrong amounts, and payments after
expiry never credit. Fulfillment mirrors the Stripe webhook path through the same tables
(`billing_subscriptions` + `billing_api_keys` + `checkout_sessions`, or
`credit_balances` for one-time packs) — there is no parallel activation path. Crypto
"subscriptions" are prepaid 30-day periods (`current_period_end = now + 30 d`); there is
no on-chain renewal, so a lapsed period simply ends unless the customer pays again.

## Decimals reference

| Asset | Base units | UI divisor | URI amount |
| --- | --- | --- | --- |
| SOL | lamports | 10⁹ | e.g. `0.06` for $9 at $150/SOL |
| USDC | mini-units | 10⁶ | e.g. `9` for $9 |

## Ops notes

- **Address rotation = change the env var and restart.** Pending orders keep the address
  they were created with (stored per row), so payments to the old address made before the
  switch still credit until those orders expire.
- **Funds go straight to the org wallet.** The server only observes; sweep/usage of funds
  is a wallet-side concern, identical to how the org treats any other direct transfer.
- **Late payments**: money that lands after order expiry is received but not credited.
  Ops can re-issue manually (generate a key for the customer via the billing DB). The
  60-minute window keeps amount-matching unambiguous.
- **Rate limits**: the crypto endpoints are unauthenticated like the rest of `/billing/*`.
  Consider a Cloudflare edge rate limit on `/billing/crypto-*` if abuse appears; the 8-char
  ref space (32⁸ ≈ 8.5×10¹¹) makes guessing infeasible at any sane request rate within
  the 60-minute order lifetime.
- **RPC quota**: each poll tick costs 1 RPC call for SOL plus 1 + token-account-count
  calls for USDC orders, only while orders are pending. The public mainnet RPC is rate
  limited; set `ACHIOTE_CRYPTO_RPC_URL` to a dedicated endpoint for production volume.
- **SOL price failures are quote-side only**: a Jupiter outage degrades SOL orders
  (`503 quote-unavailable`) but never affects USDC or already-created orders.
- **Token-2022 SPL tokens are not matched** (USDC mainnet is the classic Token program);
  setting `ACHIOTE_CRYPTO_USDC_MINT` to a Token-2022 mint will not verify.
