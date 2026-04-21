#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const tier = args.get('--tier') ?? 'free';
const name = args.get('--name') ?? 'local-admin';
const validTiers = new Set(['free', 'pro', 'business', 'enterprise']);
if (!validTiers.has(tier)) {
  console.error(`Invalid --tier ${tier}. Use one of: ${[...validTiers].join(', ')}`);
  process.exit(1);
}

function hashApiKey(rawKey) {
  return `sha256:${createHash('sha256').update(rawKey).digest('hex')}`;
}

const rawKey = `ach_${randomBytes(24).toString('hex')}`;
const envRecord = {
  keyId: `ak_${randomBytes(8).toString('hex')}`,
  keyHash: hashApiKey(rawKey),
  tier,
  name,
  createdAt: new Date().toISOString(),
};

console.log(JSON.stringify({ key: rawKey, envRecord, envExample: `ACHIOTE_API_KEYS='${JSON.stringify([envRecord])}'` }, null, 2));
console.error('\nPut envRecord inside the ACHIOTE_API_KEYS JSON array. The raw key is shown once; do not store it in configuration.');
