import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
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
      // Faithful to the real RPC: `until` returns only signatures STRICTLY NEWER
      // than it (the review pinned a mock that ignored `until`, which hid the
      // BLOCK-3 cursor blind spot). Lists are newest-first, like the RPC's.
      const all = signaturesFor.get(address) ?? [];
      if (!until) return [...all];
      const stop = all.findIndex((s) => s.signature === until);
      return stop === -1 ? [...all] : all.slice(0, stop);
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

/** Simulates a process restart on the same billing DB: fresh handle, same file. */
function restartBillingDb(): void {
  billingDb.close();
  billingDb = new BillingDb(dbPath);
}

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

  it('credits by memo reference only when the transfer covers the quoted amount (BLOCK-1)', () => {
    const order = orderView({ ref: 'AB2CD3EF', asset: 'usdc', amountUnits: 149_000_000n });
    const watchedToken = new Set([TOKEN_ACCOUNT]);
    // The exploit shape: a 1-base-unit (0.000001 USDC) transfer carrying the right
    // memo. Must NEVER credit — this test replaced one that asserted the opposite.
    const underpaid = analyzeTransaction(splTransferTx({ amount: 1n, memo: 'AB2CD3EF', blockTime: 1_000_000_500 }), watchedToken)!;
    expect(matchTransaction({ analyzed: underpaid, orders: [order], blockTimeMs: 1_000_000_500_000 })).toEqual([]);
    // Exactly the quoted amount credits.
    const exact = analyzeTransaction(splTransferTx({ amount: 149_000_000n, memo: 'AB2CD3EF', blockTime: 1_000_000_500 }), watchedToken)!;
    expect(matchTransaction({ analyzed: exact, orders: [order], blockTimeMs: 1_000_000_500_000 })).toEqual([
      { ref: 'AB2CD3EF', transfer: exact.transfers[0], reason: 'memo' },
    ]);
    // Overpaying with a memo still credits (overage is an ops matter, not a hole).
    const over = analyzeTransaction(splTransferTx({ amount: 149_000_001n, memo: 'AB2CD3EF', blockTime: 1_000_000_500 }), watchedToken)!;
    expect(matchTransaction({ analyzed: over, orders: [order], blockTimeMs: 1_000_000_500_000 })).toEqual([
      { ref: 'AB2CD3EF', transfer: over.transfers[0], reason: 'memo' },
    ]);
  });

  it('never lets an underpaid memo transfer fall through to amount-match a different order', () => {
    const underpaidFor = orderView({ ref: 'AAAREF1', asset: 'usdc', amountUnits: 149_000_000n });
    const sameAmount = orderView({ ref: 'BBBREF2', asset: 'usdc', amountUnits: 9n });
    const analyzed = analyzeTransaction(splTransferTx({ amount: 9n, memo: 'AAAREF1', blockTime: 1_000_000_500 }), new Set([TOKEN_ACCOUNT]))!;
    expect(matchTransaction({ analyzed, orders: [underpaidFor, sameAmount], blockTimeMs: 1_000_000_500_000 })).toEqual([]);
  });

  it('never amount-matches a signature more than 60 s older than the order (replay floor, BLOCK-2)', () => {
    const order = orderView({ ref: 'AB2CD3EF', asset: 'sol', amountUnits: 60_000_000n });
    // 61 s before creation: previously accepted (5-min backwards slack) — one
    // payment could credit a second, later-created same-amount order.
    const stale = analyzeTransaction(solTransferTx({ lamports: 60_000_000n, blockTime: 1_000_000_000 - 61 }), watched)!;
    expect(matchTransaction({ analyzed: stale, orders: [order], blockTimeMs: (1_000_000_000 - 61) * 1000 })).toEqual([]);
    // 60 s before creation: allowed — chain-clock skew only.
    const skew = analyzeTransaction(solTransferTx({ lamports: 60_000_000n, blockTime: 1_000_000_000 - 60 }), watched)!;
    expect(matchTransaction({ analyzed: skew, orders: [order], blockTimeMs: (1_000_000_000 - 60) * 1000 })).toHaveLength(1);
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

  it('withholds the RPC cursor while it could hide signatures a pending order still needs (BLOCK-3)', async () => {
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc, fetchSolPriceUsd: async () => 150 });
    const order = await checkout.createOrder({ tier: 'personal', mode: 'subscription', asset: 'sol' });
    fake.signaturesFor.set(RECEIVER, [
      { signature: 'failed-sig', blockTime: 1_000_000_100, err: { InstructionError: [0, { Custom: 1 }] } },
    ]);
    await checkout.tick(); // cursor now sits at failed-sig (blockTime 100 s after order creation)
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('pending');

    // The cursor is NEWER than the pending order's creation (minus the 60 s skew
    // allowance), so the next tick must poll the whole line instead: passing
    // until=failed-sig would blind the order to signatures it can still match.
    const good = addSignature(fake, RECEIVER, solTransferTx({ lamports: 60_000_000n, memo: order.ref, blockTime: 1_000_000_200 }));
    await checkout.tick();
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('paid');
    expect(billingDb.getCryptoOrder(order.ref)!.signature).toBe(good);
    expect(fake.signatureCalls[1].until).toBeUndefined();
  });

  it('advances the RPC cursor once every pending order predates it by more than the skew allowance', async () => {
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc, fetchSolPriceUsd: async () => 150 });
    // A signature 120 s old is examined while NO order exists, then an order is
    // created 60+ s after that signature: the cursor is now safely behind it.
    const stale = 'stale-but-processed';
    fake.signaturesFor.set(RECEIVER, [{ signature: stale, blockTime: 1_000_000_000 - 120, err: null }]);
    fake.transactions.set(stale, solTransferTx({ lamports: 1n, blockTime: 1_000_000_000 - 120 })); // no match
    nowMs = 1_000_000_000_000 + 120_000;
    const order = await checkout.createOrder({ tier: 'personal', mode: 'subscription', asset: 'sol' });
    await checkout.tick();
    expect(fake.signatureCalls[0].until).toBeUndefined(); // first pass: no cursor yet
    const good = addSignature(fake, RECEIVER, solTransferTx({ lamports: 60_000_000n, memo: order.ref, blockTime: 1_000_000_100 }));
    await checkout.tick();
    // Cursor (blockTime createdAt−120 s) is more than 60 s behind the order, so it is safe to use.
    expect(fake.signatureCalls[1].until).toBe(stale);
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('paid');
    expect(billingDb.getCryptoOrder(order.ref)!.signature).toBe(good);
  });

  it('does not credit a memo-matched underpayment, ever (BLOCK-1 regression)', async () => {
    const logs: string[] = [];
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc, log: (m) => logs.push(m) });
    const order = await checkout.createOrder({ tier: 'family-sprint', mode: 'payment', asset: 'usdc' }); // $149
    // Attacker pays 0.000001 USDC with the ref as memo — the reproduced exploit.
    addSignature(fake, TOKEN_ACCOUNT, splTransferTx({ amount: 1n, memo: order.ref, blockTime: 1_000_000_100, transferChecked: true }));

    await checkout.tick();

    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('pending');
    expect(billingDb.getCheckoutSession(cryptoSessionId(order.ref))!.status).toBe('pending');
    expect(billingDb.getCredits(`crypto:${order.ref}`)).toBeNull(); // no credits, no key
    expect(logs.some((m) => m.includes(order.ref) && m.includes('underpaid'))).toBe(true); // ops-visible

    // Re-examined on later ticks: still never credits.
    await checkout.tick();
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('pending');
    expect(billingDb.getCredits(`crypto:${order.ref}`)).toBeNull();
  });

  it('credits a memo-matched overpayment (overage is ops-visible, not a hole)', async () => {
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc });
    const order = await checkout.createOrder({ tier: 'memory-pack', mode: 'payment', asset: 'usdc' });
    addSignature(fake, TOKEN_ACCOUNT, splTransferTx({ amount: 49_000_001n, memo: order.ref, blockTime: 1_000_000_100, transferChecked: true }));
    await checkout.tick();
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('paid');
    expect(billingDb.getCredits(`crypto:${order.ref}`)!.webCredits).toBe(25);
  });

  it('never lets one signature credit a second order across a restart (BLOCK-2 regression)', async () => {
    const fake = makeFakeRpc();
    const first = freshCheckout({ rpc: fake.rpc });
    const orderA = await first.createOrder({ tier: 'personal', mode: 'subscription', asset: 'usdc' });
    nowMs += 1000; // B is strictly newer, so A deterministically wins the first claim
    const orderB = await first.createOrder({ tier: 'personal', mode: 'subscription', asset: 'usdc' });
    // Memo-less manual send of exactly $9: credits the oldest pending order (A).
    const sig = addSignature(fake, TOKEN_ACCOUNT, splTransferTx({ amount: 9_000_000n, blockTime: 1_000_000_100, transferChecked: true }));
    await first.tick();
    expect(billingDb.getCryptoOrder(orderA.ref)!.status).toBe('paid');
    expect(billingDb.getCryptoOrder(orderA.ref)!.signature).toBe(sig);

    // Restart: fresh DB handle, fresh poller, no in-memory cursor — the replay
    // re-sees the signature while order B is pending.
    restartBillingDb();
    const restarted = freshCheckout({ rpc: fake.rpc });
    await restarted.tick();

    expect(billingDb.getCryptoOrder(orderB.ref)!.status).toBe('pending'); // NOT credited
    expect(billingDb.getCheckoutSession(cryptoSessionId(orderB.ref))!.status).toBe('pending');
    expect(billingDb.getSubscription(`crypto-sub:${orderB.ref}`)).toBeNull(); // nothing fulfilled for B
    // A's fulfillment survived the restart exactly once.
    expect(billingDb.getCheckoutSession(cryptoSessionId(orderA.ref))!.status).toBe('completed');
  });

  it('markCryptoOrderPaid refuses a signature that already credited another order', () => {
    billingDb.createCryptoOrder({
      ref: 'AAA33333', tier: 'personal', mode: 'subscription', asset: 'usdc', amountUnits: '9000000',
      usdCents: 900, address: RECEIVER, createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z',
    });
    billingDb.createCryptoOrder({
      ref: 'BBB44444', tier: 'personal', mode: 'subscription', asset: 'usdc', amountUnits: '9000000',
      usdCents: 900, address: RECEIVER, createdAt: '2026-01-01T00:00:01.000Z', expiresAt: '2026-01-01T01:00:01.000Z',
    });
    expect(billingDb.markCryptoOrderPaid('AAA33333', 'sig-once')).toBe(true);
    expect(billingDb.markCryptoOrderPaid('BBB44444', 'sig-once')).toBe(false); // consumed
    expect(billingDb.getCryptoOrder('BBB44444')!.status).toBe('pending');
    expect(billingDb.markCryptoOrderPaid('BBB44444', 'sig-twice')).toBe(true); // a distinct signature still works
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

  it('retries fulfillment on the next tick after a transient activation failure (BLOCK-3: with an until-faithful RPC)', async () => {
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
    // The claim+fulfill transaction rolled back: no paid-without-session state,
    // no consumed signature — the order is cleanly pending again.
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('pending');
    expect(billingDb.getCryptoOrder(order.ref)!.signature).toBeNull();
    sabotaged = false;
    await checkout.tick();
    // The mock now honors `until`, and the cursor is newer than the pending
    // order, so the tick polls the whole line and re-examines the signature.
    expect(fake.signatureCalls[1].until).toBeUndefined();
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('paid');
    expect(billingDb.getCheckoutSession(cryptoSessionId(order.ref))!.status).toBe('completed');
    billingDb.completeCheckoutSession = complete;
  });

  it('rolls back and retries a failed pack fulfillment without ever double-adding credits (BLOCK-3 regression)', async () => {
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc });
    const order = await checkout.createOrder({ tier: 'family-sprint', mode: 'payment', asset: 'usdc' });
    addSignature(fake, TOKEN_ACCOUNT, splTransferTx({ amount: 149_000_000n, memo: order.ref, blockTime: 1_000_000_100, transferChecked: true }));

    const complete = billingDb.completeCheckoutSession;
    let sabotaged = true;
    billingDb.completeCheckoutSession = function (this: BillingDb, ...args: Parameters<typeof complete>) {
      if (sabotaged) throw new Error('transient failure'); // fails AFTER addCredits
      return complete.apply(this, args);
    };
    await checkout.tick();
    // addCredits ran, then completion threw — the single transaction must have
    // rolled the credits back too (previously they stuck and every retry re-added).
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('pending');
    expect(billingDb.getCredits(`crypto:${order.ref}`)).toBeNull();

    sabotaged = false;
    await checkout.tick(); // retry via whole-line re-examination
    await checkout.tick(); // sweep/idempotency: nothing left to do
    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('paid');
    const credits = billingDb.getCredits(`crypto:${order.ref}`)!;
    expect(credits.webCredits).toBe(10); // PAYMENT_OFFER_CREDITS['family-sprint'].web — exactly once
    expect(billingDb.listKeysForCustomer(`crypto:${order.ref}`)).toHaveLength(1);
    billingDb.completeCheckoutSession = complete;
  });

  it('fulfills exactly once when the process died between mark-paid and fulfillment (BLOCK-3 regression)', async () => {
    const fake = makeFakeRpc();
    const checkout = freshCheckout({ rpc: fake.rpc });
    const order = await checkout.createOrder({ tier: 'memory-pack', mode: 'payment', asset: 'usdc' });
    // Simulate the crash state the old code could leave behind: paid + signature
    // consumed, fulfillment never ran.
    expect(billingDb.markCryptoOrderPaid(order.ref, 'crash-sig')).toBe(true);

    restartBillingDb(); // "restart": fresh DB handle + fresh poller instance
    const restarted = freshCheckout({ rpc: fake.rpc });
    await restarted.tick(); // startup sweep fulfills the stranded order

    expect(billingDb.getCryptoOrder(order.ref)!.status).toBe('paid');
    expect(billingDb.getCheckoutSession(cryptoSessionId(order.ref))!.status).toBe('completed');
    expect(billingDb.getCredits(`crypto:${order.ref}`)!.webCredits).toBe(25);
    expect(billingDb.listKeysForCustomer(`crypto:${order.ref}`)).toHaveLength(1);

    await restarted.tick(); // a later sweep must not fulfill twice
    expect(billingDb.getCredits(`crypto:${order.ref}`)!.webCredits).toBe(25);
    expect(billingDb.listKeysForCustomer(`crypto:${order.ref}`)).toHaveLength(1);
  });
});

// ── signature uniqueness migration (BLOCK-2) ────────────────────────────────

describe('crypto_orders signature uniqueness migration', () => {
  it('dedupes legacy duplicate signatures (oldest row keeps the claim) and enforces UNIQUE from then on', () => {
    // Hand-build a legacy DB whose crypto_orders table predates the constraint,
    // carrying the double-credit the review reproduced: one signature on two rows.
    const dir = mkdtempSync(join(tmpdir(), 'achiote-crypto-legacy-'));
    const legacyPath = join(dir, 'legacy.db');
    const raw = new Database(legacyPath);
    raw.exec(`
      CREATE TABLE crypto_orders (
        ref TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        mode TEXT NOT NULL,
        asset TEXT NOT NULL,
        amount_units TEXT NOT NULL,
        usd_cents INTEGER NOT NULL,
        address TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        signature TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    const insert = raw.prepare(
      `INSERT INTO crypto_orders (ref, tier, mode, asset, amount_units, usd_cents, address, status, signature, created_at, expires_at)
       VALUES (?, 'personal', 'subscription', 'usdc', '9000000', 900, ?, 'paid', ?, ?, ?)`
    );
    insert.run('CCC55555', RECEIVER, 'replayed-sig', '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z'); // oldest: legitimate
    insert.run('DDD66666', RECEIVER, 'replayed-sig', '2026-01-01T00:04:00.000Z', '2026-01-01T01:04:00.000Z'); // replay duplicate
    insert.run('EEE77777', RECEIVER, 'other-sig', '2026-01-01T00:05:00.000Z', '2026-01-01T01:05:00.000Z');
    raw.close();

    const db = new BillingDb(legacyPath); // constructor runs the migration
    expect(db.getCryptoOrder('CCC55555')!.signature).toBe('replayed-sig'); // oldest keeps it
    expect(db.getCryptoOrder('DDD66666')!.signature).toBeNull(); // duplicate detached
    expect(db.getCryptoOrder('EEE77777')!.signature).toBe('other-sig'); // untouched

    // The constraint is live: a fresh order can never claim a consumed signature,
    // and a raw UPDATE violates the unique index itself.
    db.createCryptoOrder({
      ref: 'FFF88888', tier: 'personal', mode: 'subscription', asset: 'usdc', amountUnits: '9000000',
      usdCents: 900, address: RECEIVER, createdAt: '2026-01-02T00:00:00.000Z', expiresAt: '2026-01-02T01:00:00.000Z',
    });
    expect(db.markCryptoOrderPaid('FFF88888', 'replayed-sig')).toBe(false);
    const probe = new Database(legacyPath);
    expect(() =>
      probe.prepare("UPDATE crypto_orders SET signature = 'other-sig' WHERE ref = 'FFF88888'").run()
    ).toThrow(/UNIQUE constraint/);
    probe.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op on databases that already satisfy the constraint (idempotent reopen)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'achiote-crypto-mig-'));
    const path = join(dir, 'billing.db');
    const db = new BillingDb(path);
    db.createCryptoOrder({
      ref: 'GGG99999', tier: 'personal', mode: 'subscription', asset: 'usdc', amountUnits: '9000000',
      usdCents: 900, address: RECEIVER, createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z',
    });
    expect(db.markCryptoOrderPaid('GGG99999', 'clean-sig')).toBe(true);
    db.close();
    const reopened = new BillingDb(path); // re-runs the migration: nothing to dedupe
    expect(reopened.getCryptoOrder('GGG99999')!.signature).toBe('clean-sig');
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
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
