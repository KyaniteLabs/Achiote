import Stripe from 'stripe';
import type { Tier } from './auth.js';
import type { BillingDb } from './billing-db.js';

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  personalPriceId: string;
  proPriceId: string;
  familyPriceId: string;
  legacyBusinessPriceId: string;
  creditPackPriceId: string;
  baseUrl: string;
}

export function loadBillingConfigFromEnv(): BillingConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const personalPriceId = process.env.STRIPE_PERSONAL_PRICE_ID?.trim();
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID?.trim();
  const configuredFamilyPriceId = process.env.STRIPE_FAMILY_PRICE_ID?.trim();
  const legacyBusinessPriceId = process.env.STRIPE_BUSINESS_PRICE_ID?.trim();
  const familyPriceId = configuredFamilyPriceId || legacyBusinessPriceId;
  const creditPackPriceId = process.env.STRIPE_CREDIT_PACK_PRICE_ID?.trim();
  const baseUrl = process.env.STRIPE_BASE_URL?.trim() || process.env.ACHIOTE_BASE_URL?.trim();

  if (!secretKey || !webhookSecret) return null;
  if (!personalPriceId && !proPriceId && !familyPriceId && !legacyBusinessPriceId && !creditPackPriceId) return null;

  return {
    secretKey,
    webhookSecret,
    personalPriceId: personalPriceId ?? '',
    proPriceId: proPriceId ?? '',
    familyPriceId: familyPriceId ?? '',
    legacyBusinessPriceId: legacyBusinessPriceId ?? '',
    creditPackPriceId: creditPackPriceId ?? '',
    baseUrl: baseUrl || 'http://localhost:3000',
  };
}

const CREDITS_PER_PACK = { mcp: 0, web: 25 };

export class BillingStripe {
  private stripe: Stripe;
  private config: BillingConfig;

  constructor(config: BillingConfig) {
    this.config = config;
    this.stripe = new Stripe(config.secretKey);
  }

  get client(): Stripe {
    return this.stripe;
  }

  get isConfigured(): boolean {
    return Boolean(this.config.secretKey);
  }

  // ── Checkout ───────────────────────────────────────────────────────────────

  async createCheckoutSession(params: {
    tier: Tier;
    mode: 'subscription' | 'payment';
    customerEmail?: string;
  }): Promise<{ url: string; sessionId: string }> {
    const { tier, mode, customerEmail } = params;
    const priceId = this.priceIdForTier(tier, mode);
    if (!priceId) {
      throw new Error(`No Stripe price configured for tier=${tier} mode=${mode}`);
    }

    const session = await this.stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.config.baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.config.baseUrl}/#pricing`,
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      metadata: {
        tier,
        mode,
      },
    });

    if (!session.url) {
      throw new Error('Stripe checkout session created without URL');
    }

    return { url: session.url, sessionId: session.id };
  }

  async createCustomerPortalSession(stripeCustomerId: string): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${this.config.baseUrl}/#pricing`,
    });
    return { url: session.url };
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  constructEvent(payload: string | Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, this.config.webhookSecret);
  }

  async handleWebhookEvent(event: Stripe.Event, billingDb: BillingDb): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await this.handleCheckoutCompleted(session, billingDb);
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionUpdated(subscription, billingDb);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionDeleted(subscription, billingDb);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.handlePaymentFailed(invoice, billingDb);
        break;
      }
      default:
        break;
    }
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session, billingDb: BillingDb): Promise<void> {
    const customerId = typeof session.customer === 'string' ? session.customer : null;
    if (!customerId) return;

    const tier = (session.metadata?.tier as Tier) || 'personal';
    const mode = (session.metadata?.mode as 'subscription' | 'payment') || 'subscription';

    // Fetch customer email
    const customer = await this.stripe.customers.retrieve(customerId);
    const email = !customer.deleted ? customer.email ?? null : null;
    billingDb.upsertCustomer(customerId, email);

    if (mode === 'subscription') {
      // For subscriptions, the subscription ID is in the session
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
      if (subscriptionId) {
        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subAny = subscription as any;
        billingDb.upsertSubscription({
          stripeSubscriptionId: subscriptionId,
          stripeCustomerId: customerId,
          tier,
          status: subscription.status,
          currentPeriodEnd: subAny.current_period_end ? subAny.current_period_end * 1000 : null,
          createdAt: new Date(subscription.created * 1000).toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // Generate API key
        const { key, keyId } = billingDb.generateAndStoreApiKey(tier, `Billing: ${tier}`, customerId, subscriptionId);
        billingDb.completeCheckoutSession(session.id, customerId, keyId, key, tier);
      }
    } else {
      // One-time payment (credit pack)
      billingDb.addCredits(customerId, CREDITS_PER_PACK.mcp, CREDITS_PER_PACK.web);

      // Generate a credit-pack API key (free tier, but with credits)
      const { key, keyId } = billingDb.generateAndStoreApiKey('free', 'Credit Pack', customerId);
      billingDb.completeCheckoutSession(session.id, customerId, keyId, key, 'free');
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription, billingDb: BillingDb): Promise<void> {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;
    if (!customerId) return;

    // Determine tier from the subscription items
    const priceId = subscription.items.data[0]?.price.id ?? '';
    const tier = this.tierForPriceId(priceId) || 'personal';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subAny = subscription as any;

    billingDb.upsertSubscription({
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId,
      tier,
      status: subscription.status,
      currentPeriodEnd: subAny.current_period_end ? subAny.current_period_end * 1000 : null,
      createdAt: new Date(subscription.created * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Update associated API key tier
    if (subscription.status === 'active' || subscription.status === 'trialing') {
      const keys = billingDb.listKeysForCustomer(customerId);
      const subKey = keys.find((k) => k.stripeSubscriptionId === subscription.id);
      if (subKey && subKey.tier !== tier) {
        billingDb.updateKeyTier(subKey.keyId, tier);
      }
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription, billingDb: BillingDb): Promise<void> {
    billingDb.cancelSubscription(subscription.id);
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice, billingDb: BillingDb): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscriptionId = (invoice as any).subscription as string | null;
    if (!subscriptionId) return;
    billingDb.cancelSubscription(subscriptionId);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private priceIdForTier(tier: Tier, mode: 'subscription' | 'payment'): string | null {
    if (mode === 'payment') return this.config.creditPackPriceId || null;
    if (tier === 'personal') return this.config.personalPriceId || null;
    if (tier === 'pro') return this.config.proPriceId || null;
    if (tier === 'family') return this.config.familyPriceId || this.config.legacyBusinessPriceId || null;
    if (tier === 'business') return this.config.legacyBusinessPriceId || this.config.familyPriceId || null;
    return null;
  }

  private tierForPriceId(priceId: string): Tier | null {
    if (priceId === this.config.personalPriceId) return 'personal';
    if (priceId === this.config.proPriceId) return 'pro';
    if (priceId === this.config.legacyBusinessPriceId) return 'business';
    if (priceId === this.config.familyPriceId) return 'family';
    return null;
  }
}
