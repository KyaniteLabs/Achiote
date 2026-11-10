/**
 * Regression tests for real bugs in the billing lifecycles (checkout sessions,
 * crypto orders). Each one failed on the code before the explicit state
 * machines in src/lib/billing-states.ts existed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Stripe from 'stripe';
import { BillingDb } from '../src/lib/billing-db.js';
import { BillingStripe } from '../src/lib/billing-stripe.js';
import { CryptoCheckout, DEFAULT_USDC_MINT, cryptoSessionId, type SolanaRpc } from '../src/lib/billing-crypto.js';

const RECEIVER = '11111111111111111111111111111111';

let dir: string;
let billingDb: BillingDb;
let origKey: string | undefined;

beforeEach(() => {
  origKey = process.env.ACHIOTE_KEY_ENCRYPTION_KEY;
  process.env.ACHIOTE_KEY_ENCRYPTION_KEY = '0'.repeat(64);
  dir = mkdtempSync(join(tmpdir(), 'achiote-state-bugs-'));
  billingDb = new BillingDb(join(dir, 'billing.db'));
});

afterEach(() => {
  billingDb.close();
  rmSync(dir, { recursive: true, force: true });
  if (origKey === undefined) delete process.env.ACHIOTE_KEY_ENCRYPTION_KEY;
  else process.env.ACHIOTE_KEY_ENCRYPTION_KEY = origKey;
});

function rawDb(db: BillingDb): { prepare(sql: string): { run(...args: unknown[]): unknown } } {
  return (db as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db;
}

function idleRpc(): SolanaRpc {
  return {
    getSignaturesForAddress: async () => [],
    getTransaction: async () => null,
    getTokenAccountsByOwner: async () => [],
  };
}

describe('BUG: checkout-session completion is not guarded by its current state', () => {
  it('refuses to complete an already-completed session (would re-arm a consumed key with a second, different key)', () => {
    billingDb.createCheckoutSession('cs_twice', 'subscription', 'cus_1', 'personal');
    billingDb.completeCheckoutSession('cs_twice', 'cus_1', 'ak_first', 'ach_firstkey', 'personal');
    expect(billingDb.consumeCheckoutSessionApiKey('cs_twice')!.keyPlaintext).toBe('ach_firstkey');

    // Old code: the UPDATE had no status guard — it silently overwrote key_id and
    // stored a fresh plaintext, so /billing/session revealed a SECOND key.
    expect(() => billingDb.completeCheckoutSession('cs_twice', 'cus_1', 'ak_second', 'ach_secondkey', 'personal')).toThrow(
      /checkout session.*completed.*completed/i
    );
    const after = billingDb.getCheckoutSession('cs_twice')!;
    expect(after.keyId).toBe('ak_first');
    expect(after.keyPlaintext).toBeNull();
  });

  it('a completion for a session whose pending row is gone records the completion instead of silently doing nothing', () => {
    // Old code: UPDATE ... WHERE stripe_session_id = ? matched 0 rows; nothing was
    // recorded, so the idempotency check upstream never tripped.
    billingDb.completeCheckoutSession('cs_missing', 'cus_1', 'ak_x', 'ach_xkey', 'free', 'payment');
    const session = billingDb.getCheckoutSession('cs_missing');
    expect(session).not.toBeNull();
    expect(session!.status).toBe('completed');
    expect(session!.mode).toBe('payment');
  });
});

describe('BUG: crypto sweep re-fulfills forever when the pending checkout row is missing', () => {
  it('fulfills a paid order exactly once even if its checkout_sessions row was purged or never written', async () => {
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const checkout = new CryptoCheckout(
      { solAddress: RECEIVER, usdcMint: DEFAULT_USDC_MINT, rpcUrl: 'http://127.0.0.1:9' },
      billingDb,
      { rpc: idleRpc(), now: () => nowMs, log: () => undefined, fetchSolPriceUsd: async () => 150 }
    );
    const order = await checkout.createOrder({ tier: 'memory-pack', mode: 'payment', asset: 'usdc' });
    expect(billingDb.markCryptoOrderPaid(order.ref, 'sig-orphan')).toBe(true);
    // The pending checkout row disappears (purgeExpiredCheckoutSessions after a
    // long outage, or a crash between the two order-creation inserts).
    rawDb(billingDb).prepare('DELETE FROM checkout_sessions WHERE stripe_session_id = ?').run(cryptoSessionId(order.ref));

    await checkout.tick();
    nowMs += 1000;
    await checkout.tick();
    await checkout.tick();

    // Old code: every tick generated another API key and added another 25 credits.
    expect(billingDb.listKeysForCustomer(`crypto:${order.ref}`)).toHaveLength(1);
    expect(billingDb.getCredits(`crypto:${order.ref}`)!.webCredits).toBe(25);
    expect(billingDb.getCheckoutSession(cryptoSessionId(order.ref))!.status).toBe('completed');
    expect(billingDb.listPaidUnfulfilledCryptoOrders()).toHaveLength(0);
  });
});

describe('BUG: concurrent duplicate Stripe checkout.session.completed deliveries double-fulfill', () => {
  function fakeStripeBilling(): BillingStripe {
    const billing = new BillingStripe({
      secretKey: 'sk_test_123',
      webhookSecret: 'whsec_123',
      personalPriceId: 'price_personal',
      personalAnnualPriceId: '',
      proPriceId: '',
      familyPriceId: '',
      legacyBusinessPriceId: '',
      creditPackPriceId: 'price_memory_pack',
      familySprintPriceId: '',
      baseUrl: 'http://localhost:3000',
    });
    const tick = () => new Promise((r) => setTimeout(r, 5));
    (billing as unknown as { stripe: unknown }).stripe = {
      customers: { retrieve: async () => { await tick(); return { deleted: false, email: 'buyer@example.com' }; } },
      subscriptions: {
        retrieve: async () => { await tick(); return { status: 'active', created: 1_700_000_000, current_period_end: 1_800_000_000 }; },
      },
    };
    return billing;
  }

  function completedEvent(mode: 'payment' | 'subscription'): Stripe.Event {
    return {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_dup_${mode}`,
          customer: 'cus_dup',
          subscription: mode === 'subscription' ? 'sub_dup' : null,
          metadata: { tier: mode === 'payment' ? 'memory-pack' : 'personal', mode },
        },
      },
    } as unknown as Stripe.Event;
  }

  it('one-time pack: two overlapping deliveries add credits and mint a key exactly once', async () => {
    const billing = fakeStripeBilling();
    billingDb.createCheckoutSession('cs_dup_payment', 'payment');
    const event = completedEvent('payment');
    // Old code: both deliveries passed the "already completed?" check before
    // their awaits, then both added credits and minted keys.
    await Promise.allSettled([billing.handleWebhookEvent(event, billingDb), billing.handleWebhookEvent(event, billingDb)]);
    expect(billingDb.getCredits('cus_dup')!.webCredits).toBe(25);
    expect(billingDb.listKeysForCustomer('cus_dup')).toHaveLength(1);
    expect(billingDb.getCheckoutSession('cs_dup_payment')!.status).toBe('completed');
  });

  it('subscription: two overlapping deliveries mint exactly one key', async () => {
    const billing = fakeStripeBilling();
    billingDb.createCheckoutSession('cs_dup_subscription', 'subscription', undefined, 'personal');
    const event = completedEvent('subscription');
    await Promise.allSettled([billing.handleWebhookEvent(event, billingDb), billing.handleWebhookEvent(event, billingDb)]);
    expect(billingDb.listKeysForCustomer('cus_dup')).toHaveLength(1);
    const session = billingDb.getCheckoutSession('cs_dup_subscription')!;
    expect(session.keyId).toBe(billingDb.listKeysForCustomer('cus_dup')[0].keyId);
  });
});
