#!/usr/bin/env node
/**
 * Setup Stripe products and prices for Achiote billing.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe-products.mjs
 *
 * This creates:
 *   - Achiote Personal (subscription, $9/month, 25 guided memories)
 *   - Achiote Pro (subscription, $19/month, 100 guided memories)
 *   - Achiote Family Archive (subscription, $39/month, 300 guided memories)
 *   - Achiote Memory Pack (one-time, $9, 25 guided memories)
 *
 * After running, add the printed price IDs to your .env:
 *   STRIPE_PERSONAL_PRICE_ID=price_...
 *   STRIPE_PRO_PRICE_ID=price_...
 *   STRIPE_FAMILY_PRICE_ID=price_...
 *   STRIPE_CREDIT_PACK_PRICE_ID=price_...
 */

const SECRET_KEY = process.env.STRIPE_SECRET_KEY?.trim();
if (!SECRET_KEY) {
  console.error('Error: STRIPE_SECRET_KEY is required');
  console.error('Usage: STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe-products.mjs');
  process.exit(1);
}

const BASE_URL = 'https://api.stripe.com/v1';
const HEADERS = {
  Authorization: `Bearer ${SECRET_KEY}`,
  'Content-Type': 'application/x-www-form-urlencoded',
};

async function stripeFetch(path, method = 'GET', body = null) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: HEADERS,
    body: body ? new URLSearchParams(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Stripe API error: ${data.error?.message || JSON.stringify(data)}`);
  }
  return data;
}

async function createProduct(name, description) {
  const existing = await stripeFetch('/products?limit=100');
  const found = existing.data?.find((p) => p.name === name);
  if (found) {
    console.log(`Product "${name}" already exists: ${found.id}`);
    return found;
  }
  const product = await stripeFetch('/products', 'POST', { name, description });
  console.log(`Created product "${name}": ${product.id}`);
  return product;
}

async function createPrice(productId, unitAmount, currency, recurring = null) {
  const params = {
    product: productId,
    'unit_amount': String(unitAmount),
    'currency': currency,
  };
  if (recurring) {
    params['recurring[interval]'] = recurring.interval;
  }
  const price = await stripeFetch('/prices', 'POST', params);
  console.log(`Created price: ${price.id} (${recurring ? recurring.interval + 'ly' : 'one-time'})`);
  return price;
}

async function main() {
  console.log('Setting up Stripe products for Achiote...\n');

  const personalProduct = await createProduct(
    'Achiote Personal',
    'Personal tier: 25 guided memories per month'
  );
  const proProduct = await createProduct(
    'Achiote Pro',
    'Pro tier: 100 guided memories per month, image memories, and light MCP/API experimentation'
  );
  const familyProduct = await createProduct(
    'Achiote Family Archive',
    'Family Archive tier: 300 guided memories per month for collections and shared projects'
  );
  const creditProduct = await createProduct(
    'Achiote Memory Pack',
    'One-time pack: 25 guided memories, no hosted MCP/API access'
  );

  console.log('');

  const personalPrice = await createPrice(personalProduct.id, 900, 'usd', { interval: 'month' });
  const proPrice = await createPrice(proProduct.id, 1900, 'usd', { interval: 'month' });
  const familyPrice = await createPrice(familyProduct.id, 3900, 'usd', { interval: 'month' });
  const creditPrice = await createPrice(creditProduct.id, 900, 'usd');

  console.log('\n✅ Setup complete! Add these to your .env:\n');
  console.log(`STRIPE_PERSONAL_PRICE_ID=${personalPrice.id}`);
  console.log(`STRIPE_PRO_PRICE_ID=${proPrice.id}`);
  console.log(`STRIPE_FAMILY_PRICE_ID=${familyPrice.id}`);
  console.log(`STRIPE_CREDIT_PACK_PRICE_ID=${creditPrice.id}`);
  console.log('\nThen set up your webhook endpoint in the Stripe Dashboard:');
  console.log('  Endpoint URL: https://achiote.kyanitelabs.tech/billing/webhook');
  console.log('  Events to listen to: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
