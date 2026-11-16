import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BillingDb } from '../src/lib/billing-db.js';
import {
  CHECKOUT_KEY_PHASES,
  CHECKOUT_SESSION_INITIAL,
  CHECKOUT_SESSION_STATUSES,
  CHECKOUT_SESSION_TRANSITIONS,
  CRYPTO_ORDER_INITIAL,
  CRYPTO_ORDER_STATUSES,
  CRYPTO_ORDER_TRANSITIONS,
  CheckoutSessionStatus,
  CryptoOrderStatus,
  ENTITLED_SUBSCRIPTION_STATUSES,
  IllegalTransitionError,
  assertCheckoutSessionTransition,
  assertCryptoOrderTransition,
  canTransitionCheckoutSession,
  canTransitionCryptoOrder,
  checkoutKeyPhase,
  isEntitledSubscriptionStatus,
  parseCheckoutSessionStatus,
  parseCryptoOrderStatus,
  sqlStatusList,
  type CheckoutKeyPhase,
  type CheckoutSessionStatus as CheckoutStatusT,
  type CryptoOrderStatus as CryptoStatusT,
} from '../src/lib/billing-states.js';

// Expected legal moves, written out independently of the implementation. Adding a
// status to either enum without updating these tables fails the exhaustive tests.
const EXPECTED_CHECKOUT: Record<CheckoutStatusT, CheckoutStatusT[]> = {
  pending: ['completed'],
  completed: [],
};
const EXPECTED_CRYPTO: Record<CryptoStatusT, CryptoStatusT[]> = {
  pending: ['paid', 'expired'],
  paid: [],
  expired: [],
};

describe('checkout session state machine', () => {
  it('names exactly the persisted statuses and the enum object matches the list', () => {
    expect([...CHECKOUT_SESSION_STATUSES].sort()).toEqual(Object.keys(EXPECTED_CHECKOUT).sort());
    expect(Object.values(CheckoutSessionStatus).sort()).toEqual([...CHECKOUT_SESSION_STATUSES].sort());
    expect(Object.keys(CHECKOUT_SESSION_TRANSITIONS).sort()).toEqual([...CHECKOUT_SESSION_STATUSES].sort());
    expect(CHECKOUT_SESSION_INITIAL).toBe('pending');
  });

  for (const from of CHECKOUT_SESSION_STATUSES) {
    for (const to of CHECKOUT_SESSION_STATUSES) {
      const legal = EXPECTED_CHECKOUT[from].includes(to);
      it(`${from} -> ${to} is ${legal ? 'legal' : 'refused'}`, () => {
        expect(canTransitionCheckoutSession(from, to)).toBe(legal);
        if (legal) expect(() => assertCheckoutSessionTransition(from, to)).not.toThrow();
        else expect(() => assertCheckoutSessionTransition(from, to)).toThrow(IllegalTransitionError);
      });
    }
  }

  it('allows recording a completion when no row exists (the payment is real)', () => {
    expect(() => assertCheckoutSessionTransition(null, 'completed')).not.toThrow();
    expect(() => assertCheckoutSessionTransition(null, 'pending')).not.toThrow();
  });

  it('reads stored values tolerantly; unknown values read as pending (never hands out a key)', () => {
    for (const s of CHECKOUT_SESSION_STATUSES) expect(parseCheckoutSessionStatus(s)).toBe(s);
    expect(parseCheckoutSessionStatus(' Completed ')).toBe('completed');
    expect(parseCheckoutSessionStatus('refunded')).toBe('pending');
    expect(parseCheckoutSessionStatus(null)).toBe('pending');
    expect(parseCheckoutSessionStatus(42)).toBe('pending');
  });

  it('derives the key-reveal phase from (status, keyPlaintext) for every combination', () => {
    const table: Array<[CheckoutStatusT, string | null, CheckoutKeyPhase]> = [
      ['pending', null, 'awaiting_payment'],
      ['pending', 'enc', 'awaiting_payment'],
      ['completed', 'enc', 'key_ready'],
      ['completed', null, 'key_claimed'],
    ];
    const seen = new Set<CheckoutKeyPhase>();
    for (const [status, keyPlaintext, phase] of table) {
      expect(checkoutKeyPhase({ status, keyPlaintext })).toBe(phase);
      seen.add(phase);
    }
    expect([...seen].sort()).toEqual([...CHECKOUT_KEY_PHASES].sort());
    // every status is covered by the derived table
    expect(new Set(table.map(([s]) => s))).toEqual(new Set(CHECKOUT_SESSION_STATUSES));
  });
});

describe('crypto order state machine', () => {
  it('names exactly the persisted statuses and the enum object matches the list', () => {
    expect([...CRYPTO_ORDER_STATUSES].sort()).toEqual(Object.keys(EXPECTED_CRYPTO).sort());
    expect(Object.values(CryptoOrderStatus).sort()).toEqual([...CRYPTO_ORDER_STATUSES].sort());
    expect(Object.keys(CRYPTO_ORDER_TRANSITIONS).sort()).toEqual([...CRYPTO_ORDER_STATUSES].sort());
    expect(CRYPTO_ORDER_INITIAL).toBe('pending');
  });

  for (const from of CRYPTO_ORDER_STATUSES) {
    for (const to of CRYPTO_ORDER_STATUSES) {
      const legal = EXPECTED_CRYPTO[from].includes(to);
      it(`${from} -> ${to} is ${legal ? 'legal' : 'refused'}`, () => {
        expect(canTransitionCryptoOrder(from, to)).toBe(legal);
        if (legal) expect(() => assertCryptoOrderTransition(from, to)).not.toThrow();
        else expect(() => assertCryptoOrderTransition(from, to)).toThrow(IllegalTransitionError);
      });
    }
  }

  it('reads stored values tolerantly; unknown values read as expired (inert, never credited)', () => {
    for (const s of CRYPTO_ORDER_STATUSES) expect(parseCryptoOrderStatus(s)).toBe(s);
    expect(parseCryptoOrderStatus('PAID')).toBe('paid');
    expect(parseCryptoOrderStatus('refunded')).toBe('expired');
    expect(parseCryptoOrderStatus(undefined)).toBe('expired');
  });
});

describe('subscription entitlement', () => {
  it('entitles exactly active and trialing', () => {
    expect([...ENTITLED_SUBSCRIPTION_STATUSES].sort()).toEqual(['active', 'trialing']);
    for (const s of ['active', 'trialing']) expect(isEntitledSubscriptionStatus(s)).toBe(true);
    for (const s of ['canceled', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', '', null]) {
      expect(isEntitledSubscriptionStatus(s)).toBe(false);
    }
  });

  it('only inlines literal statuses into SQL', () => {
    expect(sqlStatusList(ENTITLED_SUBSCRIPTION_STATUSES)).toBe("'active', 'trialing'");
    expect(() => sqlStatusList(["x'; DROP TABLE t; --"])).toThrow();
  });
});

// ── DB-level transitions, legacy rows, and a seeded random-walk model test ────

describe('BillingDb transitions', () => {
  let dir: string;
  let db: BillingDb;
  let origKey: string | undefined;

  beforeEach(() => {
    origKey = process.env.ACHIOTE_KEY_ENCRYPTION_KEY;
    process.env.ACHIOTE_KEY_ENCRYPTION_KEY = '0'.repeat(64);
    dir = mkdtempSync(join(tmpdir(), 'achiote-states-'));
    db = new BillingDb(join(dir, 'billing.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    if (origKey === undefined) delete process.env.ACHIOTE_KEY_ENCRYPTION_KEY;
    else process.env.ACHIOTE_KEY_ENCRYPTION_KEY = origKey;
  });

  const raw = () => (db as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown } } }).db;

  function order(ref: string, createdAt = '2026-01-01T00:00:00.000Z', expiresAt = '2026-01-01T01:00:00.000Z') {
    db.createCryptoOrder({
      ref, tier: 'personal', mode: 'subscription', asset: 'usdc', amountUnits: '9000000',
      usdCents: 900, address: 'addr', createdAt, expiresAt,
    });
  }

  it('stores byte-identical status values', () => {
    db.createCheckoutSession('cs_a', 'payment');
    expect(raw().prepare("SELECT status FROM checkout_sessions WHERE stripe_session_id = 'cs_a'").get()).toEqual({ status: 'pending' });
    db.completeCheckoutSession('cs_a', 'cus', 'ak', 'ach_k', 'free');
    expect(raw().prepare("SELECT status FROM checkout_sessions WHERE stripe_session_id = 'cs_a'").get()).toEqual({ status: 'completed' });

    order('AAA');
    expect(raw().prepare("SELECT status FROM crypto_orders WHERE ref = 'AAA'").get()).toEqual({ status: 'pending' });
    db.markCryptoOrderPaid('AAA', 'sig');
    expect(raw().prepare("SELECT status FROM crypto_orders WHERE ref = 'AAA'").get()).toEqual({ status: 'paid' });
    order('BBB');
    db.expireStaleCryptoOrders('2027-01-01T00:00:00.000Z');
    expect(raw().prepare("SELECT status FROM crypto_orders WHERE ref = 'BBB'").get()).toEqual({ status: 'expired' });
  });

  it('refuses completion with no row and no mode instead of silently doing nothing', () => {
    expect(() => db.completeCheckoutSession('cs_ghost', 'cus', 'ak', 'ach_k', 'free')).toThrow(IllegalTransitionError);
    expect(db.getCheckoutSession('cs_ghost')).toBeNull();
  });

  it('paid and expired orders are terminal: no re-claim, no expiry, no claim after expiry', () => {
    order('PPP');
    expect(db.markCryptoOrderPaid('PPP', 's1')).toBe(true);
    expect(db.markCryptoOrderPaid('PPP', 's2')).toBe(false);
    expect(db.expireStaleCryptoOrders('2099-01-01T00:00:00.000Z')).toBe(0);
    expect(db.getCryptoOrder('PPP')).toMatchObject({ status: 'paid', signature: 's1' });

    order('EEE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z');
    expect(db.expireStaleCryptoOrders('2026-01-02T00:00:00.000Z')).toBe(1);
    expect(db.markCryptoOrderPaid('EEE', 's3')).toBe(false);
    expect(db.getCryptoOrder('EEE')).toMatchObject({ status: 'expired', signature: null });
  });

  it('reads a legacy/unknown stored status without crashing and treats it conservatively', () => {
    order('LEG');
    raw().prepare("UPDATE crypto_orders SET status = 'refunded' WHERE ref = 'LEG'").run();
    expect(db.getCryptoOrder('LEG')!.status).toBe('expired');
    expect(db.listPendingCryptoOrders().map((o) => o.ref)).not.toContain('LEG');
    expect(db.markCryptoOrderPaid('LEG', 'sig-leg')).toBe(false);

    db.createCheckoutSession('cs_leg', 'payment');
    raw().prepare("UPDATE checkout_sessions SET status = 'weird', key_plaintext = 'x' WHERE stripe_session_id = 'cs_leg'").run();
    const consumed = db.consumeCheckoutSessionApiKey('cs_leg');
    expect(consumed!.status).toBe('pending');
    expect(consumed!.keyPlaintext).toBe('x'); // not decrypted / handed out
  });

  it('entitled-subscription lookup and local cancel use the shared status set', () => {
    const base = { stripeCustomerId: 'cus', tier: 'pro' as const, currentPeriodEnd: null, updatedAt: '2026-01-01' };
    db.upsertSubscription({ ...base, stripeSubscriptionId: 'sub_trial', status: 'trialing', createdAt: '2026-01-01' });
    expect(db.getActiveSubscriptionForCustomer('cus')!.stripeSubscriptionId).toBe('sub_trial');
    db.upsertSubscription({ ...base, stripeSubscriptionId: 'sub_trial', status: 'past_due', createdAt: '2026-01-01' });
    expect(db.getActiveSubscriptionForCustomer('cus')).toBeNull();
    db.upsertSubscription({ ...base, stripeSubscriptionId: 'sub_trial', status: 'active', createdAt: '2026-01-01' });
    db.cancelSubscription('sub_trial');
    expect(db.getSubscription('sub_trial')!.status).toBe('canceled');
    expect(db.getActiveSubscriptionForCustomer('cus')).toBeNull();
  });

  // Stateful model test: drive random sequences of transitions against the real
  // DB and a tiny in-memory model, checking every invariant after every step.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('random transition sequences never break the lifecycle invariants (150 seeds)', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rnd = mulberry32(seed);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
      db.close();
      db = new BillingDb(':memory:');

      const orders = new Map<string, { status: CryptoStatusT; signature: string | null; expiresMs: number }>();
      const sessions = new Map<string, { status: CheckoutStatusT; keyId: string | null; claimed: boolean }>();
      const usedSigs = new Set<string>();
      let clock = 0;
      const iso = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

      for (let step = 0; step < 40; step++) {
        const op = pick(['order', 'pay', 'expire', 'session', 'complete', 'consume', 'tick'] as const);
        if (op === 'order') {
          const ref = `R${orders.size}`;
          const expiresMs = clock + 1 + Math.floor(rnd() * 5);
          order(ref, iso(clock), iso(expiresMs));
          orders.set(ref, { status: 'pending', signature: null, expiresMs });
        } else if (op === 'pay' && orders.size > 0) {
          const ref = pick([...orders.keys()]);
          const sig = `S${Math.floor(rnd() * 6)}`;
          const m = orders.get(ref)!;
          const expect_ = m.status === 'pending' && !usedSigs.has(sig);
          expect(db.markCryptoOrderPaid(ref, sig)).toBe(expect_);
          if (expect_) {
            m.status = 'paid';
            m.signature = sig;
            usedSigs.add(sig);
          }
        } else if (op === 'expire') {
          let n = 0;
          for (const m of orders.values()) if (m.status === 'pending' && m.expiresMs < clock) { m.status = 'expired'; n++; }
          expect(db.expireStaleCryptoOrders(iso(clock))).toBe(n);
        } else if (op === 'session') {
          const id = `cs${sessions.size}`;
          db.createCheckoutSession(id, 'payment');
          sessions.set(id, { status: 'pending', keyId: null, claimed: false });
        } else if (op === 'complete') {
          const id = sessions.size > 0 && rnd() < 0.8 ? pick([...sessions.keys()]) : `ghost${step}`;
          const m = sessions.get(id);
          const keyId = `ak${step}`;
          if (m && m.status === 'completed') {
            expect(() => db.completeCheckoutSession(id, 'cus', keyId, `ach_${step}`, 'free', 'payment')).toThrow(IllegalTransitionError);
          } else {
            db.completeCheckoutSession(id, 'cus', keyId, `ach_${step}`, 'free', 'payment');
            sessions.set(id, { status: 'completed', keyId, claimed: false });
          }
        } else if (op === 'consume' && sessions.size > 0) {
          const id = pick([...sessions.keys()]);
          const m = sessions.get(id)!;
          const got = db.consumeCheckoutSessionApiKey(id)!;
          if (m.status === 'completed' && !m.claimed) {
            expect(got.keyPlaintext).toMatch(/^ach_/);
            m.claimed = true;
          } else if (m.status === 'completed') {
            expect(got.keyPlaintext).toBeNull();
          }
        } else if (op === 'tick') {
          clock += 1 + Math.floor(rnd() * 3);
        }

        // Invariants after every step.
        for (const [ref, m] of orders) {
          const row = db.getCryptoOrder(ref)!;
          expect(row.status).toBe(m.status);
          expect(row.signature).toBe(m.signature);
          expect(row.status === 'paid').toBe(row.signature !== null);
        }
        const paidSigs = [...orders.values()].filter((o) => o.signature).map((o) => o.signature);
        expect(new Set(paidSigs).size).toBe(paidSigs.length);
        expect(db.listPendingCryptoOrders().map((o) => o.ref).sort()).toEqual(
          [...orders].filter(([, m]) => m.status === 'pending').map(([r]) => r).sort()
        );
        for (const [id, m] of sessions) {
          const row = db.getCheckoutSession(id)!;
          expect(row.status).toBe(m.status);
          expect(row.keyId).toBe(m.keyId);
          expect(checkoutKeyPhase(row)).toBe(
            m.status === 'pending' ? 'awaiting_payment' : m.claimed ? 'key_claimed' : 'key_ready'
          );
        }
      }
    }
  }, 30_000);
});
