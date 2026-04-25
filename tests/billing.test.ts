import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BillingDb } from '../src/lib/billing-db.js';
import { BillingStripe, loadBillingConfigFromEnv } from '../src/lib/billing-stripe.js';

describe('billing-db', () => {
  let dbPath: string;
  let billingDb: BillingDb;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'achiote-billing-'));
    dbPath = join(dir, 'billing.db');
    billingDb = new BillingDb(dbPath);
  });

  afterEach(() => {
    billingDb.close();
    rmSync(join(dbPath, '..'), { recursive: true, force: true });
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
    expect(session!.keyPlaintext).toBe('ach_testkey');
  });
});

describe('billing-stripe config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PERSONAL_PRICE_ID;
    delete process.env.STRIPE_PRO_PRICE_ID;
    delete process.env.STRIPE_FAMILY_PRICE_ID;
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

  it('returns config for personal, pro, family, and memory-pack prices', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.STRIPE_PERSONAL_PRICE_ID = 'price_personal';
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro';
    process.env.STRIPE_FAMILY_PRICE_ID = 'price_family';
    process.env.STRIPE_CREDIT_PACK_PRICE_ID = 'price_memory_pack';
    const config = loadBillingConfigFromEnv();
    expect(config).not.toBeNull();
    expect(config!.secretKey).toBe('sk_test_123');
    expect(config!.personalPriceId).toBe('price_personal');
    expect(config!.proPriceId).toBe('price_pro');
    expect(config!.familyPriceId).toBe('price_family');
    expect(config!.legacyBusinessPriceId).toBe('');
    expect(config!.creditPackPriceId).toBe('price_memory_pack');
    expect(config!.baseUrl).toBe('http://localhost:3000');
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
      proPriceId: 'price_pro',
      familyPriceId: 'price_family',
      legacyBusinessPriceId: 'price_legacy_business',
      creditPackPriceId: 'price_memory_pack',
      baseUrl: 'http://localhost:3000',
    });
    const tierForPriceId = (billing as unknown as { tierForPriceId(priceId: string): string | null }).tierForPriceId.bind(billing);

    expect(tierForPriceId('price_family')).toBe('family');
    expect(tierForPriceId('price_legacy_business')).toBe('business');
    expect(tierForPriceId('price_unknown')).toBeNull();
  });

  it('treats a business-only family fallback as the legacy business tier on Stripe updates', () => {
    const billing = new BillingStripe({
      secretKey: 'sk_test_123',
      webhookSecret: 'whsec_123',
      personalPriceId: '',
      proPriceId: '',
      familyPriceId: 'price_legacy_business',
      legacyBusinessPriceId: 'price_legacy_business',
      creditPackPriceId: '',
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
