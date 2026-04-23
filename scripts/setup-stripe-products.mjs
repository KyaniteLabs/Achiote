#!/usr/bin/env node
/**
 * Setup Stripe products and prices for Achiote billing.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe-products.mjs
 *
 * This creates:
 *   - Achiote Pro (subscription, $9/month)
 *   - Achiote Business (subscription, $49/month)
 *   - Achiote Credit Pack (one-time, $5)
 *
 * After running, add the printed price IDs to your .env:
 *   STRIPE_PRO_PRICE_ID=price_...
 *   STRIPE_BUSINESS_PRICE_ID=price_...
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
  const existing = await stripeFetch(`/products?search=${encodeURIComponent(name)}`);
  if (existing.data?.length > 0) {
    console.log(`Product "${name}" already exists: ${existing.data[0].id}`);
    return existing.data[0];
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

  const proProduct = await createProduct(
    'Achiote Pro',
    'Pro tier: 5,000 MCP calls per month, unlimited web reconstructions'
  );
  const businessProduct = await createProduct(
    'Achiote Business',
    'Business tier: 100,000 MCP calls per month, unlimited web reconstructions'
  );
  const creditProduct = await createProduct(
    'Achiote Credit Pack',
    'One-time credit pack: 1,000 extra MCP calls + 1,000 web reconstructions, never expire'
  );

  console.log('');

  const proPrice = await createPrice(proProduct.id, 900, 'usd', { interval: 'month' });
  const businessPrice = await createPrice(businessProduct.id, 4900, 'usd', { interval: 'month' });
  const creditPrice = await createPrice(creditProduct.id, 500, 'usd');

  console.log('\n✅ Setup complete! Add these to your .env:\n');
  console.log(`STRIPE_PRO_PRICE_ID=${proPrice.id}`);
  console.log(`STRIPE_BUSINESS_PRICE_ID=${businessPrice.id}`);
  console.log(`STRIPE_CREDIT_PACK_PRICE_ID=${creditPrice.id}`);
  console.log('\nThen set up your webhook endpoint in the Stripe Dashboard:');
  console.log('  Endpoint URL: https://achiote.kyanitelabs.tech/billing/webhook');
  console.log('  Events to listen to: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
