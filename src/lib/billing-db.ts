import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Tier } from './auth.js';

export interface BillingCustomer {
  stripeCustomerId: string;
  email: string | null;
  createdAt: string;
}

export interface BillingSubscription {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  tier: Tier;
  status: string;
  currentPeriodEnd: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingApiKey {
  keyId: string;
  keyHash: string;
  tier: Tier;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  name: string;
  createdAt: string;
}

export interface CreditBalance {
  stripeCustomerId: string;
  mcpCredits: number;
  webCredits: number;
  updatedAt: string;
}

export interface CheckoutSessionRecord {
  stripeSessionId: string;
  stripeCustomerId: string | null;
  keyId: string | null;
  keyPlaintext: string | null;
  tier: Tier | null;
  mode: 'subscription' | 'payment';
  status: 'pending' | 'completed';
  createdAt: string;
}

const KEY_PREFIX = 'ach_';
const KEY_ID_PREFIX = 'ak_';
const HASH_PREFIX = 'sha256:';

function hashKey(raw: string): string {
  return `${HASH_PREFIX}${createHash('sha256').update(raw).digest('hex')}`;
}

function generateKey(tier: Tier, name: string): { key: string; keyId: string; keyHash: string } {
  const secret = randomBytes(24).toString('hex');
  const key = `${KEY_PREFIX}${secret}`;
  const keyId = `${KEY_ID_PREFIX}${randomBytes(8).toString('hex')}`;
  return { key, keyId, keyHash: hashKey(key) };
}

export class BillingDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS billing_customers (
        stripe_customer_id TEXT PRIMARY KEY,
        email TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS billing_subscriptions (
        stripe_subscription_id TEXT PRIMARY KEY,
        stripe_customer_id TEXT NOT NULL,
        tier TEXT NOT NULL,
        status TEXT NOT NULL,
        current_period_end INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS billing_api_keys (
        key_id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL,
        tier TEXT NOT NULL,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS credit_balances (
        stripe_customer_id TEXT PRIMARY KEY,
        mcp_credits INTEGER NOT NULL DEFAULT 0,
        web_credits INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS checkout_sessions (
        stripe_session_id TEXT PRIMARY KEY,
        stripe_customer_id TEXT,
        key_id TEXT,
        key_plaintext TEXT,
        tier TEXT,
        mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_billing_keys_customer ON billing_api_keys(stripe_customer_id);
      CREATE INDEX IF NOT EXISTS idx_billing_keys_subscription ON billing_api_keys(stripe_subscription_id);
      CREATE INDEX IF NOT EXISTS idx_checkout_sessions_customer ON checkout_sessions(stripe_customer_id);
    `);
  }

  // ── Customers ──────────────────────────────────────────────────────────────

  upsertCustomer(stripeCustomerId: string, email: string | null): void {
    this.db.prepare(
      `INSERT INTO billing_customers (stripe_customer_id, email)
       VALUES (?, ?)
       ON CONFLICT(stripe_customer_id) DO UPDATE SET email = excluded.email`
    ).run(stripeCustomerId, email);
  }

  getCustomer(stripeCustomerId: string): BillingCustomer | null {
    const row = this.db.prepare('SELECT * FROM billing_customers WHERE stripe_customer_id = ?').get(stripeCustomerId) as
      | { stripe_customer_id: string; email: string | null; created_at: string }
      | undefined;
    if (!row) return null;
    return { stripeCustomerId: row.stripe_customer_id, email: row.email, createdAt: row.created_at };
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  upsertSubscription(sub: BillingSubscription): void {
    this.db.prepare(
      `INSERT INTO billing_subscriptions (stripe_subscription_id, stripe_customer_id, tier, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(stripe_subscription_id) DO UPDATE SET
         status = excluded.status,
         tier = excluded.tier,
         current_period_end = excluded.current_period_end,
         updated_at = excluded.updated_at`
    ).run(
      sub.stripeSubscriptionId,
      sub.stripeCustomerId,
      sub.tier,
      sub.status,
      sub.currentPeriodEnd,
      sub.createdAt,
      sub.updatedAt
    );
  }

  getSubscription(stripeSubscriptionId: string): BillingSubscription | null {
    const row = this.db.prepare('SELECT * FROM billing_subscriptions WHERE stripe_subscription_id = ?').get(stripeSubscriptionId) as
      | {
          stripe_subscription_id: string;
          stripe_customer_id: string;
          tier: Tier;
          status: string;
          current_period_end: number | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeCustomerId: row.stripe_customer_id,
      tier: row.tier,
      status: row.status,
      currentPeriodEnd: row.current_period_end,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getActiveSubscriptionForCustomer(stripeCustomerId: string): BillingSubscription | null {
    const row = this.db
      .prepare(
        "SELECT * FROM billing_subscriptions WHERE stripe_customer_id = ? AND status IN ('active', 'trialing') ORDER BY created_at DESC LIMIT 1"
      )
      .get(stripeCustomerId) as
      | {
          stripe_subscription_id: string;
          stripe_customer_id: string;
          tier: Tier;
          status: string;
          current_period_end: number | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeCustomerId: row.stripe_customer_id,
      tier: row.tier,
      status: row.status,
      currentPeriodEnd: row.current_period_end,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  cancelSubscription(stripeSubscriptionId: string): void {
    this.db.prepare(
      `UPDATE billing_subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE stripe_subscription_id = ?`
    ).run(stripeSubscriptionId);
    this.db.prepare(
      `UPDATE billing_api_keys SET tier = 'free' WHERE stripe_subscription_id = ?`
    ).run(stripeSubscriptionId);
  }

  // ── API Keys ───────────────────────────────────────────────────────────────

  generateAndStoreApiKey(tier: Tier, name: string, stripeCustomerId?: string, stripeSubscriptionId?: string): {
    key: string;
    keyId: string;
  } {
    const { key, keyId, keyHash } = generateKey(tier, name);
    this.db.prepare(
      `INSERT INTO billing_api_keys (key_id, key_hash, tier, stripe_customer_id, stripe_subscription_id, name)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(keyId, keyHash, tier, stripeCustomerId ?? null, stripeSubscriptionId ?? null, name);
    return { key, keyId };
  }

  authenticateApiKey(rawKey: string): { tier: Tier; name: string; keyId: string } | null {
    const keyHash = hashKey(rawKey);
    const row = this.db.prepare('SELECT key_id, tier, name FROM billing_api_keys WHERE key_hash = ?').get(keyHash) as
      | { key_id: string; tier: Tier; name: string }
      | undefined;
    if (!row) return null;
    return { tier: row.tier, name: row.name, keyId: row.key_id };
  }

  getApiKeyById(keyId: string): BillingApiKey | null {
    const row = this.db.prepare('SELECT * FROM billing_api_keys WHERE key_id = ?').get(keyId) as
      | {
          key_id: string;
          key_hash: string;
          tier: Tier;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          name: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      keyId: row.key_id,
      keyHash: row.key_hash,
      tier: row.tier,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      name: row.name,
      createdAt: row.created_at,
    };
  }

  updateKeyTier(keyId: string, tier: Tier): void {
    this.db.prepare('UPDATE billing_api_keys SET tier = ? WHERE key_id = ?').run(tier, keyId);
  }

  getCustomerIdByKeyId(keyId: string): string | null {
    const row = this.db.prepare('SELECT stripe_customer_id FROM billing_api_keys WHERE key_id = ?').get(keyId) as
      | { stripe_customer_id: string | null }
      | undefined;
    return row?.stripe_customer_id ?? null;
  }

  listKeysForCustomer(stripeCustomerId: string): BillingApiKey[] {
    const rows = this.db.prepare('SELECT * FROM billing_api_keys WHERE stripe_customer_id = ? ORDER BY created_at DESC').all(
      stripeCustomerId
    ) as Array<{
      key_id: string;
      key_hash: string;
      tier: Tier;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      name: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      keyId: row.key_id,
      keyHash: row.key_hash,
      tier: row.tier,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      name: row.name,
      createdAt: row.created_at,
    }));
  }

  // ── Credits ────────────────────────────────────────────────────────────────

  addCredits(stripeCustomerId: string, mcpCredits: number, webCredits: number): void {
    this.db.prepare(
      `INSERT INTO credit_balances (stripe_customer_id, mcp_credits, web_credits, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(stripe_customer_id) DO UPDATE SET
         mcp_credits = mcp_credits + excluded.mcp_credits,
         web_credits = web_credits + excluded.web_credits,
         updated_at = datetime('now')`
    ).run(stripeCustomerId, mcpCredits, webCredits);
  }

  getCredits(stripeCustomerId: string): CreditBalance | null {
    const row = this.db.prepare('SELECT * FROM credit_balances WHERE stripe_customer_id = ?').get(stripeCustomerId) as
      | { stripe_customer_id: string; mcp_credits: number; web_credits: number; updated_at: string }
      | undefined;
    if (!row) return null;
    return {
      stripeCustomerId: row.stripe_customer_id,
      mcpCredits: row.mcp_credits,
      webCredits: row.web_credits,
      updatedAt: row.updated_at,
    };
  }

  deductMcpCredit(stripeCustomerId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE credit_balances SET mcp_credits = mcp_credits - 1, updated_at = datetime('now')
         WHERE stripe_customer_id = ? AND mcp_credits > 0`
      )
      .run(stripeCustomerId);
    return result.changes > 0;
  }

  deductWebCredit(stripeCustomerId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE credit_balances SET web_credits = web_credits - 1, updated_at = datetime('now')
         WHERE stripe_customer_id = ? AND web_credits > 0`
      )
      .run(stripeCustomerId);
    return result.changes > 0;
  }

  // ── Checkout Sessions ──────────────────────────────────────────────────────

  createCheckoutSession(
    stripeSessionId: string,
    mode: 'subscription' | 'payment',
    stripeCustomerId?: string,
    tier?: Tier
  ): void {
    this.db.prepare(
      `INSERT INTO checkout_sessions (stripe_session_id, stripe_customer_id, tier, mode, status)
       VALUES (?, ?, ?, ?, 'pending')`
    ).run(stripeSessionId, stripeCustomerId ?? null, tier ?? null, mode);
  }

  completeCheckoutSession(
    stripeSessionId: string,
    stripeCustomerId: string,
    keyId: string,
    keyPlaintext: string,
    tier: Tier
  ): void {
    this.db.prepare(
      `UPDATE checkout_sessions
       SET stripe_customer_id = ?, key_id = ?, key_plaintext = ?, tier = ?, status = 'completed'
       WHERE stripe_session_id = ?`
    ).run(stripeCustomerId, keyId, keyPlaintext, tier, stripeSessionId);
  }

  getCheckoutSession(stripeSessionId: string): CheckoutSessionRecord | null {
    const row = this.db.prepare('SELECT * FROM checkout_sessions WHERE stripe_session_id = ?').get(stripeSessionId) as
      | {
          stripe_session_id: string;
          stripe_customer_id: string | null;
          key_id: string | null;
          key_plaintext: string | null;
          tier: Tier | null;
          mode: 'subscription' | 'payment';
          status: 'pending' | 'completed';
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      stripeSessionId: row.stripe_session_id,
      stripeCustomerId: row.stripe_customer_id,
      keyId: row.key_id,
      keyPlaintext: row.key_plaintext,
      tier: row.tier,
      mode: row.mode,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  consumeCheckoutSessionApiKey(stripeSessionId: string): CheckoutSessionRecord | null {
    const session = this.getCheckoutSession(stripeSessionId);
    if (!session || session.status !== 'completed' || !session.keyPlaintext) return session;
    this.db
      .prepare('UPDATE checkout_sessions SET key_plaintext = NULL WHERE stripe_session_id = ?')
      .run(stripeSessionId);
    return session;
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}

export function defaultBillingDbPath(): string {
  if (process.env.ACHIOTE_BILLING_DB) {
    return path.resolve(process.env.ACHIOTE_BILLING_DB);
  }
  const cacheRoot = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
  return path.join(cacheRoot, 'achiote', 'billing.db');
}
