/**
 * Explicit billing lifecycles. Every status value the billing tables store,
 * and every legal move between them, is named here and nowhere else.
 *
 * Persisted values are byte-compatible with what earlier code wrote
 * ('pending' / 'completed' / 'paid' / 'expired' / 'active' / 'trialing' /
 * 'canceled'); readers stay tolerant of anything unexpected already on disk.
 *
 * ── Checkout session (checkout_sessions.status) ────────────────────────────
 *
 *     (create) ──► pending ──complete──► completed
 *     (complete with no row) ──────────► completed   (the payment happened; record it)
 *
 *   completed is terminal: a second completion is refused (it would overwrite
 *   key_id and re-arm a consumed key). Within `completed` the one-time API-key
 *   reveal is a derived sub-phase: key_ready (key_plaintext set) ──consume──►
 *   key_claimed (key_plaintext NULL).
 *
 * ── Crypto order (crypto_orders.status) ────────────────────────────────────
 *
 *     (create) ──► pending ──claim(signature)──► paid
 *                     └──────expire(now)───────► expired
 *
 *   paid and expired are terminal.
 *
 * ── Subscription (billing_subscriptions.status) ────────────────────────────
 *
 *   Owned by Stripe (active, trialing, past_due, unpaid, incomplete, …) and
 *   stored verbatim, so this module does not police its transitions. It names
 *   the ONE set of statuses that entitle a key to its paid tier, and the value
 *   written when we cancel locally.
 */

export class IllegalTransitionError extends Error {
  constructor(
    public readonly machine: string,
    public readonly from: string | null,
    public readonly to: string
  ) {
    super(`Illegal ${machine} transition: ${from ?? '(none)'} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

function canMove<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  return table[from].includes(to);
}

// ── Checkout session ─────────────────────────────────────────────────────────

export const CHECKOUT_SESSION_STATUSES = ['pending', 'completed'] as const;
export type CheckoutSessionStatus = (typeof CHECKOUT_SESSION_STATUSES)[number];

export const CheckoutSessionStatus = {
  Pending: 'pending',
  Completed: 'completed',
} as const satisfies Record<string, CheckoutSessionStatus>;

export const CHECKOUT_SESSION_TRANSITIONS: TransitionTable<CheckoutSessionStatus> = {
  pending: ['completed'],
  completed: [],
};

/** The status a newly created checkout session starts in. */
export const CHECKOUT_SESSION_INITIAL: CheckoutSessionStatus = 'pending';

export function canTransitionCheckoutSession(from: CheckoutSessionStatus, to: CheckoutSessionStatus): boolean {
  return canMove(CHECKOUT_SESSION_TRANSITIONS, from, to);
}

/**
 * Refuses an illegal checkout-session move. `from === null` means no row
 * exists: completing a session we never saw is allowed (the payment is real).
 */
export function assertCheckoutSessionTransition(from: CheckoutSessionStatus | null, to: CheckoutSessionStatus): void {
  if (from === null) {
    if (to === 'completed' || to === CHECKOUT_SESSION_INITIAL) return;
    throw new IllegalTransitionError('checkout session', from, to);
  }
  if (!canTransitionCheckoutSession(from, to)) throw new IllegalTransitionError('checkout session', from, to);
}

/**
 * Tolerant reader for a stored checkout status. An unknown value reads as
 * `pending`: the conservative choice, since `pending` never hands out a key.
 */
export function parseCheckoutSessionStatus(raw: unknown): CheckoutSessionStatus {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (CHECKOUT_SESSION_STATUSES as readonly string[]).includes(value) ? (value as CheckoutSessionStatus) : 'pending';
}

/** Derived phase of the one-time API-key reveal on a checkout session. */
export const CHECKOUT_KEY_PHASES = ['awaiting_payment', 'key_ready', 'key_claimed'] as const;
export type CheckoutKeyPhase = (typeof CHECKOUT_KEY_PHASES)[number];

export function checkoutKeyPhase(session: { status: CheckoutSessionStatus; keyPlaintext: string | null }): CheckoutKeyPhase {
  if (session.status === 'pending') return 'awaiting_payment';
  return session.keyPlaintext ? 'key_ready' : 'key_claimed';
}

// ── Crypto order ─────────────────────────────────────────────────────────────

export const CRYPTO_ORDER_STATUSES = ['pending', 'paid', 'expired'] as const;
export type CryptoOrderStatus = (typeof CRYPTO_ORDER_STATUSES)[number];

export const CryptoOrderStatus = {
  Pending: 'pending',
  Paid: 'paid',
  Expired: 'expired',
} as const satisfies Record<string, CryptoOrderStatus>;

export const CRYPTO_ORDER_TRANSITIONS: TransitionTable<CryptoOrderStatus> = {
  pending: ['paid', 'expired'],
  paid: [],
  expired: [],
};

export const CRYPTO_ORDER_INITIAL: CryptoOrderStatus = 'pending';

export function canTransitionCryptoOrder(from: CryptoOrderStatus, to: CryptoOrderStatus): boolean {
  return canMove(CRYPTO_ORDER_TRANSITIONS, from, to);
}

export function assertCryptoOrderTransition(from: CryptoOrderStatus, to: CryptoOrderStatus): void {
  if (!canTransitionCryptoOrder(from, to)) throw new IllegalTransitionError('crypto order', from, to);
}

/**
 * Tolerant reader for a stored crypto order status. An unknown value reads as
 * `expired`: terminal and inert — it is never claimed, credited or fulfilled.
 */
export function parseCryptoOrderStatus(raw: unknown): CryptoOrderStatus {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (CRYPTO_ORDER_STATUSES as readonly string[]).includes(value) ? (value as CryptoOrderStatus) : 'expired';
}

// ── Subscription entitlement ─────────────────────────────────────────────────

/** Stripe statuses under which a subscription's key keeps its paid tier. */
export const ENTITLED_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const;

/** Status written when Achiote cancels a subscription locally (deleted / payment failed). */
export const CANCELED_SUBSCRIPTION_STATUS = 'canceled';

/** Status a crypto-funded subscription is created with. */
export const CRYPTO_SUBSCRIPTION_STATUS: (typeof ENTITLED_SUBSCRIPTION_STATUSES)[number] = 'active';

export function isEntitledSubscriptionStatus(status: unknown): boolean {
  return typeof status === 'string' && (ENTITLED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

// ── SQL helper ───────────────────────────────────────────────────────────────

/** Renders a constant status list as a SQL `IN (...)` body. Values are compile-time literals, never user input. */
export function sqlStatusList(values: readonly string[]): string {
  for (const v of values) {
    if (!/^[a-z_]+$/.test(v)) throw new Error(`Refusing to inline non-literal status ${JSON.stringify(v)} into SQL`);
  }
  return values.map((v) => `'${v}'`).join(', ');
}
