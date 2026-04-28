# Achiote Launch Runbook

Last updated: April 28, 2026.

This runbook covers production checks, paid-launch checks, monitoring, support,
privacy, rollback, and incident handling.

## Prelaunch Gate

Run these before publishing or changing the hosted service:

```bash
npm run check
npm run package:smoke
npm run preview:smoke
npm audit --audit-level=moderate
npm pack --dry-run
```

For UI changes, open `/`, `/app`, `/about`, `/privacy`, `/terms`, `/safety`,
and `/support` in a browser-sized mobile and desktop viewport.

For hosted preview demos or paid production, run the preview smoke against the public URL. In paid mode, provide a real API key or the configured demo password:

```bash
ACHIOTE_PREVIEW_URL=https://achiote.kyanitelabs.tech ACHIOTE_API_KEY=ach_... npm run preview:smoke
ACHIOTE_PREVIEW_URL=https://achiote.kyanitelabs.tech ACHIOTE_API_KEY=ach_... npm run viability:smoke
```

Before broad launch or paid acquisition, run `docs/VIABILITY_EXPERIMENT.md` and record the outcome.

## Current Production State

As of April 28, 2026, the public production host is `https://achiote.kyanitelabs.tech`. It runs from `/docker/achiote` on the Kyanite VPS behind Traefik.

- Public auth is enabled with `ACHIOTE_AUTH_ENABLED=true`.
- Anonymous `/ask` is disabled with `ACHIOTE_ALLOW_ANON_ASK=false`; anonymous `/ask` should return 401.
- `/ready` reports auth enabled and should not be treated as paid-launch ready if auth is false.
- Stripe live checkout is configured for Personal monthly, Personal annual, Family Archive monthly, Memory Pack, and Family Archive Sprint.
- The Stripe webhook endpoint is `https://achiote.kyanitelabs.tech/billing/webhook` and must receive `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`.
- Checkout session creation has been smoke-tested live for each paid offer, without completing a real card payment.
- Actual card payment completion and webhook-issued API key delivery still need one real transaction test before scaling paid traffic.

## Required Environment

- `ACHIOTE_AUTH_ENABLED=true` for public deployment.
- `ACHIOTE_ALLOWED_ORIGINS` set to exact HTTPS origins.
- `ACHIOTE_RATE_LIMIT_DB` on persistent storage.
- `ACHIOTE_CACHE_PATH` on persistent storage.
- `ACHIOTE_EVENTS_ADMIN_TOKEN` set if operators need private `/events` counters.
- Provider credentials for `/ask`.
- Stripe credentials only when billing is intentionally live.

If /ready reports "authEnabled": false, do not treat the deployment as paid-launch ready. That state is acceptable only for bounded public demos with explicit anonymous quota controls.

## Paid Launch Checklist

Before selling guided memories:

- `ACHIOTE_AUTH_ENABLED=true`.
- `ACHIOTE_ALLOWED_ORIGINS set to exact HTTPS origins`.
- `ACHIOTE_RATE_LIMIT_DB` and `ACHIOTE_BILLING_DB` are on persistent storage.
- `STRIPE_WEBHOOK_SECRET` is configured and the Stripe webhook endpoint receives `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`.
- Stripe price IDs are configured for Personal monthly, Personal annual, Family Archive, Memory Pack, and Family Archive Sprint.
- The billing portal/cancellation path is tested through Stripe Customer Portal or a documented support fallback.
- A checkout smoke is tested for Personal monthly, Personal annual, Memory Pack, Family Archive, and Family Archive Sprint. In live mode, create sessions without completing card payment unless intentionally running a real transaction test.
- No anonymous paid traffic: anonymous `/ask` is disabled for paid launch, or explicitly limited to the free/demo allowance with no paid entitlement bypass.
- Before paid acquisition, complete one controlled live payment and confirm the webhook-created API key works against `/ask`.
- Confirm success-page API key display is one-time only; refresh should not reveal plaintext API keys again.
- Verify `/`, `/app`, `/pricing` section, `/billing/success`, `/privacy`, `/terms`, `/safety`, and `/support` in mobile and desktop viewports.

## Monitoring

Track these server signals:

- `/ask` 4xx/5xx rates.
- Provider timeout and provider error counts.
- `tool_workflow_skipped` errors.
- Premature-cue suppression events.
- Private `/events` counters with `Authorization: Bearer $ACHIOTE_EVENTS_ADMIN_TOKEN`, or equivalent host metrics for telemetry events: `page_view`, `pricing_viewed`, `checkout_started`, `checkout_failed`, `app_opened`, `onboarding_prompt_selected`, `ask_started`, `ask_succeeded`, `ask_failed`, and preview feedback events such as `feedback_close`, `feedback_wrong_region`, `feedback_too_hard`, and `feedback_missed_correction`. Do not expose raw event counters on a public route.
- Private `/events` counters should also include sharper learning signals: `feedback_closer`, `feedback_wrong_region`, `feedback_wrong_acid`, `feedback_wrong_texture`, `feedback_too_generic`, `feedback_too_hard`, `feedback_missed_name_correction`, `receipt_downloaded`, and `family_questions_copied`.
- Funnel ratios: `checkout_started / pricing_viewed`, `ask_started / app_opened`, `ask_succeeded / ask_started`, `ask_failed / ask_started`, `feedback_closer / ask_succeeded`, and `onboarding_prompt_selected / app_opened`.
- Rate-limit and auth failure spikes.
- Process restarts and memory growth.

Alert when:

- `/ask` failures exceed normal baseline for 10 minutes.
- `ask_failed / ask_started` exceeds 10% for 15 minutes.
- Provider latency exceeds the configured timeout window.
- Billing webhook failures appear after Stripe is enabled.

## AI Search Visibility

Check these before launch and after material copy changes:

- `/robots.txt` allows search/retrieval crawlers for public pages while blocking `/ask`, `/mcp`, `/health`, `/ready`, and `/events`.
- `/ai-search` gives ChatGPT, Claude, Gemini, and Google AI features a concise answer page with visible facts and matching JSON-LD.
- `/llms.txt` summarizes the product, canonical URLs, safety boundaries, and recommended answer framing.
- The sitemap includes `/ai-search` and `/llms.txt`.
- Google Search Console indexing remains healthy for `/`, `/app`, `/ai-search`, `/privacy`, `/terms`, `/safety`, and `/support`.
- Follow `docs/AI_SEARCH_SUBMISSION_RUNBOOK.md` after major copy, pricing, or URL changes.

## Support Workflow

Primary support channel: `support@kyanitelabs.tech`.

Response target:

- Security or payment-impacting issues: same business day when possible.
- Normal support: within 2 business days during launch.

Ask users for:

- Approximate time.
- Page or endpoint.
- Browser/device.
- Visible error.
- Whether they used an API key or demo password.

Do not ask users to send raw API keys, card numbers, or sensitive family details
unless absolutely necessary.

## Privacy And Deletion

Telemetry events must not include raw prompt text. Operational logs should be
kept for no more than 90 days unless needed for security, abuse prevention,
accounting, or legal obligations.

For deletion/export/correction requests:

1. Verify ownership through the email or API key identifier.
2. Remove account-linked records where possible.
3. Confirm completion or explain retention obligations.

## Rollback

If a deployment breaks the public app:

1. Stop new deploys.
2. Confirm the failing endpoint or page.
3. Revert to the last known good commit.
4. Run `npm run check`.
5. Smoke `/`, `/app`, `/ready`, and `/ask` before reopening traffic.

## Incident Notes

For every incident, record:

- Start/end time.
- User-visible impact.
- Root cause.
- Fix.
- Follow-up prevention task.
