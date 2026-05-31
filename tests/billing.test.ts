import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BillingDb } from '../src/lib/billing-db.js';
import { BillingStripe, loadBillingConfigFromEnv } from '../src/lib/billing-stripe.js';

describe('billing-db', () => {
  let dbPath: string;
  let billingDb: BillingDb;
  let origEncryptionKey: string | undefined;

  beforeEach(() => {
    origEncryptionKey = process.env.ACHIOTE_KEY_ENCRYPTION_KEY;
    process.env.ACHIOTE_KEY_ENCRYPTION_KEY = '0'.repeat(64);
    const dir = mkdtempSync(join(tmpdir(), 'achiote-billing-'));
    dbPath = join(dir, 'billing.db');
    billingDb = new BillingDb(dbPath);
  });

  afterEach(() => {
    billingDb.close();
    rmSync(join(dbPath, '..'), { recursive: true, force: true });
    if (origEncryptionKey === undefined) {
      delete process.env.ACHIOTE_KEY_ENCRYPTION_KEY;
    } else {
      process.env.ACHIOTE_KEY_ENCRYPTION_KEY = origEncryptionKey;
    }
  });

  it('creates schema on initialization', () => {
    // If init didn't throw, schema was created
    expect(billingDb).toBeDefined();
  });

  it('upserts and retrieves customers', () => {
    billingDb.upsertCustomer('cus_123', 'test@example.com');
    const customer = billingDb.getCustomer('cus_123');
    expect(customer).not.toBeNull();
    expect(customer!.stripeCustomerId).toBe('cus_123');
    expect(customer!.email).toBe('test@example.com');
  });

  it('updates customer email on conflict', () => {
    billingDb.upsertCustomer('cus_123', 'old@example.com');
    billingDb.upsertCustomer('cus_123', 'new@example.com');
    const customer = billingDb.getCustomer('cus_123');
    expect(customer!.email).toBe('new@example.com');
  });

  it('generates and authenticates API keys', () => {
    const { key, keyId } = billingDb.generateAndStoreApiKey('pro', 'Test Key', 'cus_123');
    expect(key).toMatch(/^ach_[a-f0-9]{48}$/);
    expect(keyId).toMatch(/^ak_[a-f0-9]{16}$/);

    const auth = billingDb.authenticateApiKey(key);
    expect(auth).not.toBeNull();
    expect(auth!.tier).toBe('pro');
    expect(auth!.name).toBe('Test Key');
    expect(auth!.keyId).toBe(keyId);

    // Wrong key should fail
    expect(billingDb.authenticateApiKey('ach_invalid')).toBeNull();
  });

  it('retrieves customer ID by key ID', () => {
    const { key, keyId } = billingDb.generateAndStoreApiKey('pro', 'Test', 'cus_456');
    expect(billingDb.getCustomerIdByKeyId(keyId)).toBe('cus_456');
    expect(billingDb.getCustomerIdByKeyId('nonexistent')).toBeNull();
  });

  it('manages subscriptions', () => {
    billingDb.upsertSubscription({
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_123',
      tier: 'pro',
      status: 'active',
      currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const sub = billingDb.getSubscription('sub_123');
    expect(sub).not.toBeNull();
    expect(sub!.tier).toBe('pro');
    expect(sub!.status).toBe('active');

    const activeSub = billingDb.getActiveSubscriptionForCustomer('cus_123');
    expect(activeSub).not.toBeNull();
    expect(activeSub!.stripeSubscriptionId).toBe('sub_123');
  });

  it('cancels subscriptions and downgrades keys', () => {
    billingDb.generateAndStoreApiKey('pro', 'Sub Key', 'cus_123', 'sub_123');
    billingDb.upsertSubscription({
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_123',
      tier: 'pro',
      status: 'active',
      currentPeriodEnd: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    billingDb.cancelSubscription('sub_123');

    const sub = billingDb.getSubscription('sub_123');
    expect(sub!.status).toBe('canceled');

    const keys = billingDb.listKeysForCustomer('cus_123');
    expect(keys[0].tier).toBe('free');
  });

  it('manages credit balances', () => {
    billingDb.addCredits('cus_123', 100, 50);
    let balance = billingDb.getCredits('cus_123');
    expect(balance).not.toBeNull();
    expect(balance!.mcpCredits).toBe(100);
    expect(balance!.webCredits).toBe(50);

    billingDb.addCredits('cus_123', 50, 25);
    balance = billingDb.getCredits('cus_123');
    expect(balance!.mcpCredits).toBe(150);
    expect(balance!.webCredits).toBe(75);

    expect(billingDb.deductMcpCredit('cus_123')).toBe(true);
    balance = billingDb.getCredits('cus_123');
    expect(balance!.mcpCredits).toBe(149);

    expect(billingDb.deductMcpCredit('cus_nonexistent')).toBe(false);
  });

  it('manages checkout sessions', () => {
    billingDb.createCheckoutSession('cs_123', 'subscription', 'cus_123', 'pro');
    let session = billingDb.getCheckoutSession('cs_123');
    expect(session).not.toBeNull();
    expect(session!.status).toBe('pending');
    expect(session!.tier).toBe('pro');

    billingDb.completeCheckoutSession('cs_123', 'cus_123', 'ak_test', 'ach_testkey', 'pro');
    session = billingDb.getCheckoutSession('cs_123');
    expect(session!.status).toBe('completed');
    expect(session!.keyPlaintext).not.toBe('ach_testkey');
    expect(session!.keyPlaintext).toBeTruthy();
  });

  it('reveals checkout API keys once and clears plaintext after display', () => {
    billingDb.createCheckoutSession('cs_once', 'subscription', 'cus_123', 'personal');
    billingDb.completeCheckoutSession('cs_once', 'cus_123', 'ak_once', 'ach_oncekey', 'personal');

    const first = billingDb.consumeCheckoutSessionApiKey('cs_once');
    expect(first).toMatchObject({
      status: 'completed',
      tier: 'personal',
      keyId: 'ak_once',
      keyPlaintext: 'ach_oncekey',
    });

    const stored = billingDb.getCheckoutSession('cs_once');
    expect(stored!.keyPlaintext).toBeNull();

    const second = billingDb.consumeCheckoutSessionApiKey('cs_once');
    expect(second).toMatchObject({
      status: 'completed',
      tier: 'personal',
      keyId: 'ak_once',
      keyPlaintext: null,
    });
  });

  it('preserves pre-encryption plaintext checkout keys long enough to consume once', () => {
    billingDb.createCheckoutSession('cs_legacy_plain', 'subscription', 'cus_123', 'personal');
    const rawDb = (billingDb as unknown as {
      db: { prepare(sql: string): { run(...args: unknown[]): unknown } };
    }).db;
    rawDb
      .prepare("UPDATE checkout_sessions SET stripe_customer_id = ?, key_id = ?, key_plaintext = ?, tier = ?, status = 'completed' WHERE stripe_session_id = ?")
      .run('cus_123', 'ak_legacy', 'ach_legacykey', 'personal', 'cs_legacy_plain');
    delete process.env.ACHIOTE_KEY_ENCRYPTION_KEY;

    expect(billingDb.consumeCheckoutSessionApiKey('cs_legacy_plain')).toMatchObject({
      keyPlaintext: 'ach_legacykey',
    });
    expect(billingDb.getCheckoutSession('cs_legacy_plain')!.keyPlaintext).toBeNull();
  });

  it('fails checkout key storage when the encryption key is missing or malformed', () => {
    billingDb.createCheckoutSession('cs_bad_key', 'subscription', 'cus_123', 'personal');
    process.env.ACHIOTE_KEY_ENCRYPTION_KEY = 'not-hex';

    expect(() => billingDb.completeCheckoutSession('cs_bad_key', 'cus_123', 'ak_bad', 'ach_badkey', 'personal')).toThrow('required');
  });
});

describe('billing-stripe config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ACHIOTE_KEY_ENCRYPTION_KEY = '0'.repeat(64);
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PERSONAL_PRICE_ID;
    delete process.env.STRIPE_PRO_PRICE_ID;
    delete process.env.STRIPE_FAMILY_PRICE_ID;
    delete process.env.STRIPE_PERSONAL_ANNUAL_PRICE_ID;
    delete process.env.STRIPE_MEMORY_PACK_PRICE_ID;
    delete process.env.STRIPE_FAMILY_SPRINT_PRICE_ID;
    delete process.env.STRIPE_BUSINESS_PRICE_ID;
    delete process.env.STRIPE_CREDIT_PACK_PRICE_ID;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns null when Stripe keys are missing', () => {
    expect(loadBillingConfigFromEnv()).toBeNull();
  });

  it('returns null when only secret key is present', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    expect(loadBillingConfigFromEnv()).toBeNull();
  });

  it('returns null when no price IDs are configured', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    expect(loadBillingConfigFromEnv()).toBeNull();
  });

  it('returns null without billing key encryption because checkout delivery depends on it', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.STRIPE_PERSONAL_PRICE_ID = 'price_personal';
    delete process.env.ACHIOTE_KEY_ENCRYPTION_KEY;
    expect(loadBillingConfigFromEnv()).toBeNull();
  });

  it('returns null when billing key encryption is malformed', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.STRIPE_PERSONAL_PRICE_ID = 'price_personal';
    process.env.ACHIOTE_KEY_ENCRYPTION_KEY = 'not-hex';
    expect(loadBillingConfigFromEnv()).toBeNull();
  });

  it('returns config for personal, annual personal, family, and memory-pack prices', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.STRIPE_PERSONAL_PRICE_ID = 'price_personal';
    process.env.STRIPE_PERSONAL_ANNUAL_PRICE_ID = 'price_personal_annual';
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro';
    process.env.STRIPE_FAMILY_PRICE_ID = 'price_family';
    process.env.STRIPE_MEMORY_PACK_PRICE_ID = 'price_memory_pack';
    process.env.STRIPE_FAMILY_SPRINT_PRICE_ID = 'price_family_sprint';
    const config = loadBillingConfigFromEnv();
    expect(config).not.toBeNull();
    expect(config!.secretKey).toBe('sk_test_123');
    expect(config!.personalPriceId).toBe('price_personal');
    expect(config!.personalAnnualPriceId).toBe('price_personal_annual');
    expect(config!.proPriceId).toBe('price_pro');
    expect(config!.familyPriceId).toBe('price_family');
    expect(config!.legacyBusinessPriceId).toBe('');
    expect(config!.creditPackPriceId).toBe('price_memory_pack');
    expect(config!.familySprintPriceId).toBe('price_family_sprint');
    expect(config!.baseUrl).toBe('http://localhost:3000');
  });

  it('keeps STRIPE_CREDIT_PACK_PRICE_ID as a memory-pack fallback during migration', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.STRIPE_CREDIT_PACK_PRICE_ID = 'price_legacy_pack';
    const config = loadBillingConfigFromEnv();
    expect(config).not.toBeNull();
    expect(config!.creditPackPriceId).toBe('price_legacy_pack');
  });

  it('keeps the old business price ID as a family fallback during migration', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.STRIPE_BUSINESS_PRICE_ID = 'price_legacy_business';
    const config = loadBillingConfigFromEnv();
    expect(config).not.toBeNull();
    expect(config!.familyPriceId).toBe('price_legacy_business');
    expect(config!.legacyBusinessPriceId).toBe('price_legacy_business');
  });

  it('maps new family and legacy business Stripe prices without silently downgrading old subscriptions', () => {
    const billing = new BillingStripe({
      secretKey: 'sk_test_123',
      webhookSecret: 'whsec_123',
      personalPriceId: 'price_personal',
      personalAnnualPriceId: 'price_personal_annual',
      proPriceId: 'price_pro',
      familyPriceId: 'price_family',
      legacyBusinessPriceId: 'price_legacy_business',
      creditPackPriceId: 'price_memory_pack',
      familySprintPriceId: 'price_family_sprint',
      baseUrl: 'http://localhost:3000',
    });
    const tierForPriceId = (billing as unknown as { tierForPriceId(priceId: string): string | null }).tierForPriceId.bind(billing);

    expect(tierForPriceId('price_family')).toBe('family');
    expect(tierForPriceId('price_personal_annual')).toBe('personal');
    expect(tierForPriceId('price_legacy_business')).toBe('business');
    expect(tierForPriceId('price_unknown')).toBeNull();
  });

  it('selects explicit paid-launch checkout prices for monthly, annual, and one-time offers', () => {
    const billing = new BillingStripe({
      secretKey: 'sk_test_123',
      webhookSecret: 'whsec_123',
      personalPriceId: 'price_personal',
      personalAnnualPriceId: 'price_personal_annual',
      proPriceId: 'price_pro',
      familyPriceId: 'price_family',
      legacyBusinessPriceId: 'price_legacy_business',
      creditPackPriceId: 'price_memory_pack',
      familySprintPriceId: 'price_family_sprint',
      baseUrl: 'http://localhost:3000',
    });
    const priceIdForTier = (billing as unknown as {
      priceIdForTier(tier: string, mode: 'subscription' | 'payment', billingCycle?: 'monthly' | 'annual'): string | null;
    }).priceIdForTier.bind(billing);

    expect(priceIdForTier('personal', 'subscription', 'monthly')).toBe('price_personal');
    expect(priceIdForTier('personal', 'subscription', 'annual')).toBe('price_personal_annual');
    expect(priceIdForTier('family', 'subscription', 'monthly')).toBe('price_family');
    expect(priceIdForTier('memory-pack', 'payment')).toBe('price_memory_pack');
    expect(priceIdForTier('family-sprint', 'payment')).toBe('price_family_sprint');
    expect(priceIdForTier('personal', 'payment')).toBeNull();
  });

  it('treats a business-only family fallback as the legacy business tier on Stripe updates', () => {
    const billing = new BillingStripe({
      secretKey: 'sk_test_123',
      webhookSecret: 'whsec_123',
      personalPriceId: '',
      personalAnnualPriceId: '',
      proPriceId: '',
      familyPriceId: 'price_legacy_business',
      legacyBusinessPriceId: 'price_legacy_business',
      creditPackPriceId: '',
      familySprintPriceId: '',
      baseUrl: 'http://localhost:3000',
    });
    const tierForPriceId = (billing as unknown as { tierForPriceId(priceId: string): string | null }).tierForPriceId.bind(billing);

    expect(tierForPriceId('price_legacy_business')).toBe('business');
  });

  it('uses STRIPE_BASE_URL when set', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.STRIPE_PERSONAL_PRICE_ID = 'price_123';
    process.env.STRIPE_BASE_URL = 'https://example.com';
    const config = loadBillingConfigFromEnv();
    expect(config!.baseUrl).toBe('https://example.com');
  });
});
