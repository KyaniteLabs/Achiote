#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

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

const record = {
  key: `ach_${randomBytes(24).toString('hex')}`,
  tier,
  name,
  createdAt: new Date().toISOString(),
};

console.log(JSON.stringify(record, null, 2));
console.error('\nAdd this object to the ACHIOTE_API_KEYS JSON array for self-hosted HTTP auth.');
