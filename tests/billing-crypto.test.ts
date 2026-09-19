import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BillingDb } from '../src/lib/billing-db.js';
import {
  CryptoCheckout,
  CryptoOrderError,
  DEFAULT_RPC_URL,
  DEFAULT_USDC_MINT,
  baseUnitsForUsdCents,
  buildSolanaPayUri,
  createHttpSolanaRpc,
  decodeBase58,
  formatUiAmount,
  generateCryptoRef,
  analyzeTransaction,
  loadCryptoConfigFromEnv,
  matchTransaction,
  solLamportsForUsdCents,
  CRYPTO_REF_CHARSET,
  CRYPTO_ORDER_TTL_MS,
  cryptoSessionId,
  type OrderView,
  type SignatureInfo,
  type SolanaRpc,
} from '../src/lib/billing-crypto.js';

// ── fixtures ────────────────────────────────────────────────────────────────

const RECEIVER = '11111111111111111111111111111111'; // valid base58 32-byte key (system program id)
const SENDER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const TOKEN_ACCOUNT = 'TokenAccountDestination1111111111111111111111';
const USDC_MINT = DEFAULT_USDC_MINT;
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const byte of bytes) num = num * 256n + BigInt(byte);
  let encoded = '';
  while (num > 0n) {
    encoded = BASE58_ALPHABET[Number(num % 58n)] + encoded;
    num /= 58n;
  }
  for (const byte of bytes) {
    if (byte === 0) encoded = `1${encoded}`;
    else break;
  }
  return encoded || '1';
}

function u64le(value: bigint | number): Uint8Array {
  const bytes = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

function u32le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  bytes[0] = value & 0xff;
  bytes[1] = (value >> 8) & 0xff;
  bytes[2] = (value >> 16) & 0xff;
  bytes[3] = (value >> 24) & 0xff;
  return bytes;
}

function solTransferTx(opts: {
  to?: string;
  from?: string;
  lamports: bigint;
  memo?: string;
  blockTime: number;
  err?: unknown;
  destinationInLoadedAddresses?: boolean;
}): unknown {
  const to = opts.to ?? RECEIVER;
  const from = opts.from ?? SENDER;
  const keys = [from, SYSTEM_PROGRAM, to, MEMO_PROGRAM];
  const instructions: Array<{ programIdIndex: number; accounts: number[]; data: string }> = [];
  if (opts.memo !== undefined) {
    instructions.push({
      programIdIndex: 3,
      accounts: [],
      data: encodeBase58(new TextEncoder().encode(opts.memo)),
    });
  }
  instructions.push({
    programIdIndex: 1,
    accounts: opts.destinationInLoadedAddresses ? [0, 3] : [0, 2],
    data: encodeBase58(new Uint8Array([...u32le(2), ...u64le(opts.lamports)])),
  });
  if (opts.destinationInLoadedAddresses) {
    return {
      blockTime: opts.blockTime,
      meta: { err: opts.err ?? null, loadedAddresses: { writable: [to], readonly: [] } },
      transaction: { message: { accountKeys: [from, SYSTEM_PROGRAM, MEMO_PROGRAM], instructions } },
    };
  }
  return {
    blockTime: opts.blockTime,
    meta: { err: opts.err ?? null, loadedAddresses: { writable: [], readonly: [] } },
    transaction: { message: { accountKeys: keys, instructions } },
  };
}

function splTransferTx(opts: {
  destination?: string;
  amount: bigint;
  memo?: string;
  blockTime: number;
  transferChecked?: boolean;
}): unknown {
  const destination = opts.destination ?? TOKEN_ACCOUNT;
  const keys = [SENDER, TOKEN_PROGRAM, destination, MEMO_PROGRAM, USDC_MINT];
  const instructions: Array<{ programIdIndex: number; accounts: number[]; data: string }> = [];
  if (opts.memo !== undefined) {
    instructions.push({
      programIdIndex: 3,
      accounts: [],
      data: encodeBase58(new TextEncoder().encode(opts.memo)),
    });
  }
  if (opts.transferChecked) {
    instructions.push({
      programIdIndex: 1,
      accounts: [0, 4, 2],
      data: encodeBase58(new Uint8Array([12, ...u64le(opts.amount), 6])),
    });
  } else {
    instructions.push({
      programIdIndex: 1,
      accounts: [0, 2],
      data: encodeBase58(new Uint8Array([3, ...u64le(opts.amount)])),
    });
  }
  return {
    blockTime: opts.blockTime,
    meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
    transaction: { message: { accountKeys: keys, instructions } },
  };
}

function orderView(params: {
  ref: string;
  asset: 'sol' | 'usdc';
  amountUnits: bigint;
  createdAtMs?: number;
  ttlMs?: number;
}): OrderView {
  const createdAtMs = params.createdAtMs ?? 1_000_000_000_000;
  return {
    ref: params.ref,
    asset: params.asset,
    amountUnits: params.amountUnits,
    createdAtMs,
    expiresAtMs: createdAtMs + (params.ttlMs ?? CRYPTO_ORDER_TTL_MS),
  };
}

function makeFakeRpc(): { rpc: SolanaRpc; signaturesFor: Map<string, SignatureInfo[]>; transactions: Map<string, unknown>; tokenAccounts: string[]; signatureCalls: Array<{ address: string; until?: string }> } {
  const signaturesFor = new Map<string, SignatureInfo[]>();
  const transactions = new Map<string, unknown>();
  const signatureCalls: Array<{ address: string; until?: string }> = [];
  const tokenAccounts = [TOKEN_ACCOUNT];
  const rpc: SolanaRpc = {
    async getSignaturesForAddress(address: string, until?: string) {
      signatureCalls.push({ address, until });
      return signaturesFor.get(address) ?? [];
    },
    async getTransaction(signature: string) {
      return transactions.get(signature) ?? null;
    },
    async getTokenAccountsByOwner() {
      return tokenAccounts;
    },
  };
  return { rpc, signaturesFor, transactions, tokenAccounts, signatureCalls };
}

function addSignature(fake: ReturnType<typeof makeFakeRpc>, address: string, tx: unknown, blockTime = 1_000_000_500): string {
  const signature = `sig${fake.signatureCalls.length}-${Math.random().toString(36).slice(2, 8)}`;
  fake.transactions.set(signature, tx);
  const existing = fake.signaturesFor.get(address) ?? [];
  existing.unshift({ signature, blockTime, err: null });
  fake.signaturesFor.set(address, existing);
  return signature;
}

let nowMs = 1_000_000_000_000;
function fakeNow(): number {
  return nowMs;
}

let dbPath: string;
let billingDb: BillingDb;
let origEncryptionKey: string | undefined;

function freshCheckout(deps: ConstructorParameters<typeof CryptoCheckout>[2] = {}): CryptoCheckout {
  return new CryptoCheckout(
    { solAddress: RECEIVER, usdcMint: USDC_MINT, rpcUrl: 'http://127.0.0.1:9' },
    billingDb,
    { now: fakeNow, log: () => {}, ...deps }
  );
}

beforeEach(() => {
  origEncryptionKey = process.env.ACHIOTE_KEY_ENCRYPTION_KEY;
  process.env.ACHIOTE_KEY_ENCRYPTION_KEY = '0'.repeat(64);
  nowMs = 1_000_000_000_000;
  const dir = mkdtempSync(join(tmpdir(), 'achiote-crypto-'));
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

// ── config ─────────────────────────────────────────────────────────────────

describe('crypto config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ACHIOTE_KEY_ENCRYPTION_KEY = '0'.repeat(64);
    delete process.env.ACHIOTE_CRYPTO_SOL_ADDRESS;
    delete process.env.ACHIOTE_CRYPTO_USDC_MINT;
    delete process.env.ACHIOTE_CRYPTO_RPC_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns null when no receive address is set (feature dark)', () => {
    expect(loadCryptoConfigFromEnv()).toBeNull();
  });

  it('returns null for an invalid base58 address', () => {
    process.env.ACHIOTE_CRYPTO_SOL_ADDRESS = 'not a base58 key 0O0I';
    expect(loadCryptoConfigFromEnv()).toBeNull();
  });

  it('returns null without the key encryption material key handoff depends on', () => {
    process.env.ACHIOTE_CRYPTO_SOL_ADDRESS = RECEIVER;
    delete process.env.ACHIOTE_KEY_ENCRYPTION_KEY;
    expect(loadCryptoConfigFromEnv()).toBeNull();
    process.env.ACHIOTE_KEY_ENCRYPTION_KEY = 'not-hex';
    expect(loadCryptoConfigFromEnv()).toBeNull();
  });

  it('applies documented defaults for mint and RPC', () => {
    process.env.ACHIOTE_CRYPTO_SOL_ADDRESS = RECEIVER;
    const config = loadCryptoConfigFromEnv();
    expect(config).not.toBeNull();
    expect(config!.solAddress).toBe(RECEIVER);
    expect(config!.usdcMint).toBe(DEFAULT_USDC_MINT);
    expect(config!.rpcUrl).toBe(DEFAULT_RPC_URL);
  });

  it('honors explicit mint and RPC overrides', () => {
    process.env.ACHIOTE_CRYPTO_SOL_ADDRESS = RECEIVER;
    process.env.ACHIOTE_CRYPTO_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    process.env.ACHIOTE_CRYPTO_RPC_URL = 'https://rpc.example.com';
    const config = loadCryptoConfigFromEnv();
    expect(config!.rpcUrl).toBe('https://rpc.example.com');
  });
});

// ── refs ────────────────────────────────────────────────────────────────────

describe('order references', () => {
  it('generates 8-char codes from the unambiguous charset', () => {
    const ref = generateCryptoRef(() => 0);
    expect(ref).toBe('22222222');
    expect(generateCryptoRef(() => CRYPTO_REF_CHARSET.length - 1)).toBe('Z'.repeat(8));
  });

  it('never contains 0, O, 1, or I across many draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const ref = generateCryptoRef();
      expect(ref).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
      seen.add(ref);
    }
    expect(seen.size).toBeGreaterThan(400);
  });
});

// ── amounts and URIs ────────────────────────────────────────────────────────

describe('crypto amount math', () => {
  it('converts USD cents to exact USDC base units (6 decimals, 1:1)', () => {
    expect(baseUnitsForUsdCents(900, 6)).toBe(9_000_000n);
    expect(baseUnitsForUsdCents(4900, 6)).toBe(49_000_000n);
    expect(baseUnitsForUsdCents(3900, 6)).toBe(39_000_000n);
    expect(baseUnitsForUsdCents(14900, 6)).toBe(149_000_000n);
  });

  it('quotes SOL lamports from a spot price with integer rounding', () => {
    expect(solLamportsForUsdCents(900, 150)).toBe(60_000_000n); // $9 / $150 = 0.06 SOL
    expect(solLamportsForUsdCents(900, 100)).toBe(90_000_000n);
    expect(solLamportsForUsdCents(14900, 250)).toBe(596_000_000n); // $149 / $250 = 0.596 SOL
  });

  it('stays within one lamport of the float computation for live prices', () => {
    const price = 111.42351246033631; // real Jupiter response
    const expected = BigInt(Math.round((900 / 100 / price) * 1e9));
    const diff = solLamportsForUsdCents(900, price) - expected;
    expect(diff >= -1n && diff <= 1n).toBe(true);
  });

  it('renders UI amounts with correct decimals and trimmed zeros', () => {
    expect(formatUiAmount(60_000_000n, 9)).toBe('0.06');
    expect(formatUiAmount(6_000_000_000n, 9)).toBe('6');
    expect(formatUiAmount(1n, 9)).toBe('0.000000001');
    expect(formatUiAmount(9_000_000n, 6)).toBe('9');
    expect(formatUiAmount(9_123_450n, 6)).toBe('9.12345');
  });

  it('builds exact Solana Pay URIs (SOL: 9dp UI units; USDC: spl-token + 6dp)', () => {
    expect(
      buildSolanaPayUri({ address: RECEIVER, amount: '0.06', ref: 'AB2CD3EF' })
    ).toBe(`solana:${RECEIVER}?amount=0.06&label=Achiote&memo=AB2CD3EF`);
    expect(
      buildSolanaPayUri({ address: RECEIVER, amount: '9', ref: 'AB2CD3EF', splTokenMint: USDC_MINT })
    ).toBe(`solana:${RECEIVER}?amount=9&spl-token=${USDC_MINT}&label=Achiote&memo=AB2CD3EF`);
  });
});

// ── order creation ──────────────────────────────────────────────────────────

describe('crypto order creation', () => {
  it('creates USDC orders for every live tier at exact USD parity', async () => {
    const checkout = freshCheckout();
    for (const [tier, mode, cents] of [
      ['personal', 'subscription', 900],
      ['family', 'subscription', 3900],
      ['memory-pack', 'payment', 4900],
      ['family-sprint', 'payment', 14900],
    ] as const) {
      const order = await checkout.createOrder({ tier, mode, asset: 'usdc' });
      expect(order.asset).toBe('usdc');
      expect(order.address).toBe(RECEIVER);
      expect(order.amount).toBe(formatUiAmount(baseUnitsForUsdCents(cents, 6), 6));
      expect(order.uri).toContain(`spl-token=${USDC_MINT}`);
      expect(order.uri).toContain(`memo=${order.ref}`);
      expect(order.expiresAtMs).toBe(fakeNow() + CRYPTO_ORDER_TTL_MS);
      const stored = billingDb.getCryptoOrder(order.ref);
      expect(stored).toMatchObject({ tier, mode, asset: 'usdc', status: 'pending', address: RECEIVER });
      expect(stored!.amountUnits).toBe(baseUnitsForUsdCents(cents, 6).toString());
      expect(billingDb.getCheckoutSession(cryptoSessionId(order.ref))).toMatchObject({ status: 'pending', mode });
    }
  });

  it('quotes SOL from the cached spot price', async () => {
    let fetches = 0;
    const checkout = freshCheckout({ fetchSolPriceUsd: async () => { fetches++; return 150; } });
    const first = await checkout.createOrder({ tier: 'personal', mode: 'subscription', asset: 'sol' });
    expect(first.amount).toBe('0.06');
    expect(first.uri).toBe(`solana:${RECEIVER}?amount=0.06&label=Achiote&memo=${first.ref}`);
    expect(first.uri).not.toContain('spl-token');
    const second = await checkout.createOrder({ tier: 'family', mode: 'subscription', asset: 'sol' });
    expect(second.amount).toBe('0.26'); // $39 / $150
    expect(fetches).toBe(1); // 60s cache
  });

  it('fails SOL orders with 503 quote-unavailable while USDC keeps working', async () => {
    const checkout = freshCheckout({ fetchSolPriceUsd: async () => null });
    await expect(checkout.createOrder({ tier: 'personal', mode: 'subscription', asset: 'sol' })).rejects.toBeInstanceOf(CryptoOrderError);
    await expect(checkout.createOrder({ tier: 'personal', mode: 'subscription', asset: 'sol' })).rejects.toMatchObject({
      status: 503,
      message: 'quote-unavailable',
    });
    const usdc = await checkout.createOrder({ tier: 'personal', mode: 'subscription', asset: 'usdc' });
    expect(usdc.amount).toBe('9');
  });

  it('validates tier and mode against the same tables as Stripe checkout', async () => {
    const checkout = freshCheckout();
    await expect(checkout.createOrder({ tier: 'pro', mode: 'subscription', asset: 'usdc' })).rejects.toMatchObject({
      status: 400,
      message: 'Invalid tier for subscription. Use personal or family.',
    });
    await expect(checkout.createOrder({ tier: 'personal', mode: 'payment', asset: 'usdc' })).rejects.toMatchObject({
      status: 400,
      message: 'Invalid tier for one-time payment. Use memory-pack or family-sprint.',
    });
    await expect(checkout.createOrder({ tier: 'family-sprint', mode: 'subscription', asset: 'usdc' })).rejects.toMatchObject({ status: 400 });
    await expect(checkout.createOrder({ tier: 'memory-pack', mode: 'subscription', asset: 'usdc' })).rejects.toMatchObject({ status: 400 });
  });

  it('expires stale orders on status reads', async () => {
    const checkout = freshCheckout();
    const order = await checkout.createOrder({ tier: 'personal', mode: 'subscription', asset: 'usdc' });
    expect((await checkout.getOrderStatus(order.ref)).status).toBe('pending');
    nowMs += CRYPTO_ORDER_TTL_MS + 1;
    expect((await checkout.getOrderStatus(order.ref)).status).toBe('expired');
    await expect(checkout.getOrderStatus('ZZZZZZ99')).rejects.toMatchObject({ status: 404 });
  });
});

// ── deterministic verification ──────────────────────────────────────────────

describe('transaction analysis and matching', () => {
  const watched = new Set([RECEIVER]);

  it('extracts memo texts and SOL transfers to the watched address', () => {
    const tx = solTransferTx({ lamports: 60_000_000n, memo: 'Achiote order AB2CD3EF', blockTime: 1_000_000_500 });
    const analyzed = analyzeTransaction(tx, watched)!;
    expect(analyzed).not.toBeNull();
    expect(analyzed.memos).toEqual(['Achiote order AB2CD3EF']);
    expect(analyzed.transfers).toEqual([{ asset: 'sol', destination: RECEIVER, amountUnits: 60_000_000n }]);
  });

  it('ignores transfers to other addresses', () => {
    const tx = solTransferTx({ to: SENDER, lamports: 60_000_000n, memo: 'AB2CD3EF', blockTime: 1_000_000_500 });
    const analyzed = analyzeTransaction(tx, watched)!;
    expect(analyzed.transfers).toEqual([]);
  });

  it('reads v0 destination keys from loadedAddresses', () => {
    const tx = solTransferTx({ lamports: 5n, blockTime: 1_000_000_500, destinationInLoadedAddresses: true });
    const analyzed = analyzeTransaction(tx, new Set([RECEIVER]))!;
    expect(analyzed.transfers).toHaveLength(1);
    expect(analyzed.transfers[0].destination).toBe(RECEIVER);
  });
  it('decodes SPL transfer and transferChecked instructions to watched token accounts', () => {
    for (const transferChecked of [false, true]) {
      const tx = splTransferTx({ amount: 9_000_000_000n, blockTime: 1_000_000_500, transferChecked });
      const analyzed = analyzeTransaction(tx, new Set([TOKEN_ACCOUNT]))!;
      expect(analyzed.transfers).toEqual([{ asset: 'usdc', destination: TOKEN_ACCOUNT, amountUnits: 9_000_000_000n }]);
    }
  });

  it('returns null for failed transactions', () => {
    const tx = solTransferTx({ lamports: 60_000_000n, blockTime: 1_000_000_500, err: { InstructionError: [0, { Custom: 1 }] } });
    expect(analyzeTransaction(tx, watched)).toBeNull();
  });

  it('credits by memo reference regardless of exact amount', () => {
    const order = orderView({ ref: 'AB2CD3EF', asset: 'sol', amountUnits: 1n });
    const tx = solTransferTx({ lamports: 123_456n, memo: 'AB2CD3EF', blockTime: 1_000_000_500 });
    const analyzed = analyzeTransaction(tx, watched)!;
    expect(matchTransaction({ analyzed, orders: [order], blockTimeMs: 1_000_000_500_000 })).toEqual([
      { ref: 'AB2CD3EF', transfer: analyzed.transfers[0], reason: 'memo' },
    ]);
  });

  it('credits by exact amount when no memo exists and blockTime is inside the window', () => {
    const order = orderView({ ref: 'AB2CD3EF', asset: 'sol', amountUnits: 60_000_000n });
    const tx = solTransferTx({ lamports: 60_000_000n, blockTime: 1_000_000_500 });
    const analyzed = analyzeTransaction(tx, watched)!;
    expect(matchTransaction({ analyzed, orders: [order], blockTimeMs: 1_000_000_500_000 })).toEqual([
      { ref: 'AB2CD3EF', transfer: analyzed.transfers[0], reason: 'amount' },
    ]);
  });

  it('ignores wrong amounts when no memo matches', () => {
    const order = orderView({ ref: 'AB2CD3EF', asset: 'sol', amountUnits: 60_000_000n });
    const tx = solTransferTx({ lamports: 59_999_999n, blockTime: 1_000_000_500 });
    const analyzed = analyzeTransaction(tx, watched)!;
    expect(matchTransaction({ analyzed, orders: [order], blockTimeMs: 1_000_000_500_000 })).toEqual([]);
  });

  it('ignores amount matches outside the order window', () => {
    const order = orderView({ ref: 'AB2CD3EF', asset: 'sol', amountUnits: 60_000_000n });
    const early = analyzeTransaction(solTransferTx({ lamports: 60_000_000n, blockTime: 999_999_000 }), watched)!;
    expect(matchTransaction({ analyzed: early, orders: [order], blockTimeMs: 999_999_000_000 })).toEqual([]);
    // 4000s after creation: past the 60-minute expiry plus the 5-minute clock slack.
    const late = analyzeTransaction(solTransferTx({ lamports: 60_000_000n, blockTime: 1_000_004_000 }), watched)!;
    expect(matchTransaction({ analyzed: late, orders: [order], blockTimeMs: 1_000_004_000_000 })).toEqual([]);
  });

  it('requires a blockTime for the amount fallback but not for memo matches', () => {
    const order = orderView({ ref: 'AB2CD3EF', asset: 'sol', amountUnits: 60_000_000n });
    const noMemo = analyzeTransaction(solTransferTx({ lamports: 60_000_000n, blockTime: 1_000_000_500 }), watched)!;
    expect(matchTransaction({ analyzed: noMemo, orders: [order], blockTimeMs: null })).toEqual([]);
    const withMemo = analyzeTransaction(solTransferTx({ lamports: 60_000_000n, memo: 'AB2CD3EF', blockTime: 1_000_000_500 }), watched)!;
    expect(matchTransaction({ analyzed: withMemo, orders: [order], blockTimeMs: null })).toHaveLength(1);
  });

  it('credits the oldest of two identical-amount orders from one transfer', () => {
    const older = orderView({ ref: 'OLDREF1', asset: 'sol', amountUnits: 60_000_000n, createdAtMs: 999_999_999_000 });
    const newer = orderView({ ref: 'NEWREF1', asset: 'sol', amountUnits: 60_000_000n, createdAtMs: 1_000_000_000_000 });
    const analyzed = analyzeTransaction(solTransferTx({ lamports: 60_000_000n, blockTime: 1_000_000_500 }), watched)!;
    const matches = matchTransaction({ analyzed, orders: [newer, older], blockTimeMs: 1_000_000_500_000 });
    expect(matches).toHaveLength(1);
    expect(matches[0].ref).toBe('OLDREF1');
  });
});

// ── poller + fulfillment ────────────────────────────────────────────────────

describe('crypto poller', () => {
  it('credits SOL orders end-to-end (memo path) with a mocked price and RPC', async () => {
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc, fetchSolPriceUsd: async () => 150 });
    const order = await checkout.createOrder({ tier: 'personal', mode: 'subscription', asset: 'sol' });
    expect(order.amount).toBe('0.06');
    const lamports = 60_000_000n;
    addSignature(fake, RECEIVER, solTransferTx({ lamports, memo: order.ref, blockTime: 1_000_000_100 }));

    await checkout.tick();

    const stored = billingDb.getCryptoOrder(order.ref)!;
    expect(stored.status).toBe('paid');
    expect(stored.signature).toMatch(/^sig/);

    const session = billingDb.getCheckoutSession(cryptoSessionId(order.ref))!;
    expect(session.status).toBe('completed');
    expect(session.tier).toBe('personal');
    const consumed = billingDb.consumeCheckoutSessionApiKey(cryptoSessionId(order.ref))!;
    expect(consumed.keyPlaintext).toMatch(/^ach_[a-f0-9]{48}$/);
    expect(billingDb.authenticateApiKey(consumed.keyPlaintext!)).toMatchObject({ tier: 'personal' });

    const sub = billingDb.getSubscription(`crypto-sub:${order.ref}`)!;
    expect(sub.status).toBe('active');
    expect(sub.tier).toBe('personal');
    expect(sub.currentPeriodEnd! - Date.parse(sub.createdAt)).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('credits USDC orders via the owned token account (amount path) and fulfills one-time credits', async () => {
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc });
    const order = await checkout.createOrder({ tier: 'memory-pack', mode: 'payment', asset: 'usdc' });
    addSignature(fake, TOKEN_ACCOUNT, splTransferTx({ amount: 49_000_000n, blockTime: 1_000_000_100, transferChecked: true }));

    await checkout.tick();

    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('paid');
    const credits = billingDb.getCredits(`crypto:${order.ref}`)!;
    expect(credits.webCredits).toBe(25); // PAYMENT_OFFER_CREDITS['memory-pack'].web
    const consumed = billingDb.consumeCheckoutSessionApiKey(cryptoSessionId(order.ref))!;
    expect(consumed.tier).toBe('free');
    expect(billingDb.authenticateApiKey(consumed.keyPlaintext!)).toMatchObject({ name: 'Memory Pack' });
  });

  it('does not call the RPC when no orders are pending', async () => {
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc });
    await checkout.tick();
    expect(fake.signatureCalls).toHaveLength(0);
  });

  it('skips failed signatures and passes until= to the RPC after the first pass', async () => {
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc, fetchSolPriceUsd: async () => 150 });
    const order = await checkout.createOrder({ tier: 'personal', mode: 'subscription', asset: 'sol' });
    fake.signaturesFor.set(RECEIVER, [
      { signature: 'failed-sig', blockTime: 1_000_000_100, err: { InstructionError: [0, { Custom: 1 }] } },
    ]);
    await checkout.tick();
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('pending');

    const good = addSignature(fake, RECEIVER, solTransferTx({ lamports: 60_000_000n, memo: order.ref, blockTime: 1_000_000_200 }));
    await checkout.tick();
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('paid');
    expect(billingDb.getCryptoOrder(order.ref)!.signature).toBe(good);
    expect(fake.signatureCalls[1].until).toBe('failed-sig');
  });

  it('never credits an expired order even if the payment lands afterwards', async () => {
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc, fetchSolPriceUsd: async () => 150 });
    const order = await checkout.createOrder({ tier: 'personal', mode: 'subscription', asset: 'sol' });
    nowMs += CRYPTO_ORDER_TTL_MS + 60_000;
    addSignature(fake, RECEIVER, solTransferTx({ lamports: 60_000_000n, memo: order.ref, blockTime: Math.floor(nowMs / 1000) }));
    await checkout.tick();
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('expired');
  });

  it('retries fulfillment on the next tick after a transient activation failure', async () => {
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc, fetchSolPriceUsd: async () => 150 });
    const order = await checkout.createOrder({ tier: 'personal', mode: 'subscription', asset: 'sol' });
    addSignature(fake, RECEIVER, solTransferTx({ lamports: 60_000_000n, memo: order.ref, blockTime: 1_000_000_100 }));

    const complete = billingDb.completeCheckoutSession;
    let sabotaged = true;
    billingDb.completeCheckoutSession = function (this: BillingDb, ...args: Parameters<typeof complete>) {
      if (sabotaged) throw new Error('transient failure');
      return complete.apply(this, args);
    };
    await checkout.tick();
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('pending'); // reopened
    sabotaged = false;
    await checkout.tick();
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('paid');
    expect(billingDb.getCheckoutSession(cryptoSessionId(order.ref))!.status).toBe('completed');
    billingDb.completeCheckoutSession = complete;
  });
});

// ── RPC backoff ─────────────────────────────────────────────────────────────

describe('RPC retry policy', () => {
  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  it('retries 429s with exponential backoff up to 5 attempts, then fails', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return jsonResponse(429, {});
    }) as typeof fetch;
    const rpc = createHttpSolanaRpc('https://rpc.test', { fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    await expect(rpc.getSignaturesForAddress(RECEIVER)).rejects.toThrow('429');
    expect(calls).toBe(5);
    expect(sleeps).toEqual([500, 1000, 2000, 4000]);
  });

  it('succeeds once the rate limit clears', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls <= 2) return jsonResponse(429, {});
      return jsonResponse(200, { result: [{ signature: 'abc', blockTime: 1, err: null }] });
    }) as typeof fetch;
    const rpc = createHttpSolanaRpc('https://rpc.test', { fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    const sigs = await rpc.getSignaturesForAddress(RECEIVER);
    expect(sigs).toEqual([{ signature: 'abc', blockTime: 1, err: null }]);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('does not retry method-level JSON-RPC errors', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return jsonResponse(200, { error: { message: 'Invalid params' } });
    }) as typeof fetch;
    const rpc = createHttpSolanaRpc('https://rpc.test', { fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    await expect(rpc.getTransaction('abc')).rejects.toThrow('Invalid params');
    expect(calls).toBe(1);
  });
});

// ── base58 helper ───────────────────────────────────────────────────────────

describe('base58', () => {
  it('round-trips arbitrary bytes', () => {
    for (const bytes of [new Uint8Array(32).fill(7), new TextEncoder().encode('hello memo'), new Uint8Array([0, 0, 1, 2, 255])]) {
      expect(decodeBase58(encodeBase58(bytes))).toEqual(bytes);
    }
  });

  it('rejects invalid characters', () => {
    expect(() => decodeBase58('0OIl')).toThrow();
  });
});
