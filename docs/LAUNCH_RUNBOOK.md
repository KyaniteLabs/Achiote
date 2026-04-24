# Achiote Launch Runbook

Last updated: April 24, 2026.

This runbook covers the non-Stripe launch basics: production checks, monitoring,
support, privacy, rollback, and incident handling.

## Prelaunch Gate

Run these before publishing or changing the hosted service:

```bash
npm run check
npm run package:smoke
npm audit --audit-level=moderate
npm pack --dry-run
```

For UI changes, open `/`, `/app`, `/about`, `/privacy`, `/terms`, `/safety`,
and `/support` in a browser-sized mobile and desktop viewport.

## Required Environment

- `ACHIOTE_AUTH_ENABLED=true` for public deployment.
- `ACHIOTE_ALLOWED_ORIGINS` set to exact HTTPS origins.
- `ACHIOTE_RATE_LIMIT_DB` on persistent storage.
- `ACHIOTE_CACHE_PATH` on persistent storage.
- `ACHIOTE_EVENTS_ADMIN_TOKEN` set if operators need private `/events` counters.
- Provider credentials for `/ask`.
- Stripe credentials only when billing is intentionally live.

## Monitoring

Track these server signals:

- `/ask` 4xx/5xx rates.
- Provider timeout and provider error counts.
- `tool_workflow_skipped` errors.
- Premature-cue suppression events.
- Private `/events` counters with `Authorization: Bearer $ACHIOTE_EVENTS_ADMIN_TOKEN`, or equivalent host metrics for telemetry events: `ask_started`, `ask_succeeded`, `ask_failed`, feedback events, and checkout starts. Do not expose raw event counters on a public route.
- Rate-limit and auth failure spikes.
- Process restarts and memory growth.

Alert when:

- `/ask` failures exceed normal baseline for 10 minutes.
- `ask_failed / ask_started` exceeds 10% for 15 minutes.
- Provider latency exceeds the configured timeout window.
- Billing webhook failures appear after Stripe is enabled.

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
