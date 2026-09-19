// Direct-to-wallet Solana checkout (SOL + USDC). No Stripe, no custodial account, no
// private keys: the server only knows a PUBLIC receive address and credits orders by
// verifying on-chain transfers via the public Solana JSON-RPC.
//
// Flow: POST /billing/crypto-order creates a pending order (ref + Solana Pay URI) →
// buyer pays from any wallet → a background poller watches the receive address (and its
// USDC token accounts) for new signatures → getTransaction → deterministic match rules
// (memo ref, or exact amount within the order window) → fulfillment mirrors the Stripe
// webhook activation path through the shared billing tables.
import { randomInt } from 'node:crypto';
import type { Tier } from './auth.js';
import type { BillingDb, CryptoOrderRecord } from './billing-db.js';
import { PAYMENT_OFFER_CREDITS, PAYMENT_OFFER_KEY_NAMES, type CheckoutPaymentOffer } from './billing-stripe.js';

export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const DEFAULT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';
export const JUPITER_PRICE_URL = 'https://lite-api.jup.ag/price/v3';

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MEMO_PROGRAM_IDS = new Set([
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfBdKfHseQ3rAwbaCMmfWcLdy8uYSuxf9Lc8',
]);

/** 8-char code with no visually ambiguous glyphs (no 0/O, 1/I). It is the order's bearer proof. */
export const CRYPTO_REF_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CRYPTO_REF_LENGTH = 8;
export const CRYPTO_ORDER_TTL_MS = 60 * 60 * 1000;
/** Crypto subscriptions are prepaid monthly periods; no auto-renewal exists off-chain. */
export const CRYPTO_SUB_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
/** Chain blockTime vs server clock skew tolerance for amount-window matching. */
const WINDOW_SLACK_MS = 5 * 60 * 1000;
const PRICE_CACHE_TTL_MS = 60 * 1000;
const RPC_MAX_ATTEMPTS = 5;
const RPC_BACKOFF_BASE_MS = 500;
const RPC_TIMEOUT_MS = 10_000;
const MAX_TOKEN_ACCOUNTS_WATCHED = 4;
const SOL_PRICE_MIN_USD = 0.01;
const SOL_PRICE_MAX_USD = 100_000;

export type CryptoAsset = 'sol' | 'usdc';

export interface CryptoConfig {
  solAddress: string;
  usdcMint: string;
  rpcUrl: string;
}

/** USD price table mirrors the live Stripe tiers exactly (cents). */
const CRYPTO_TIER_PRICES: Record<string, { mode: 'subscription' | 'payment'; usdCents: number }> = {
  personal: { mode: 'subscription', usdCents: 900 },
  family: { mode: 'subscription', usdCents: 3900 },
  'memory-pack': { mode: 'payment', usdCents: 4900 },
  'family-sprint': { mode: 'payment', usdCents: 14900 },
};

export function priceUsdCentsForTier(tier: string, mode: 'subscription' | 'payment'): number | null {
  const entry = CRYPTO_TIER_PRICES[tier];
  if (!entry || entry.mode !== mode) return null;
  return entry.usdCents;
}

export class CryptoOrderError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'CryptoOrderError';
  }
}

// ── base58 (Bitcoin alphabet, as used by Solana) ────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map<string, number>([...BASE58_ALPHABET].map((ch, i) => [ch, i]));

export function decodeBase58(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  let num = 0n;
  for (const ch of input) {
    const idx = BASE58_INDEX.get(ch);
    if (idx === undefined) throw new Error(`invalid base58 character: ${ch}`);
    num = num * 58n + BigInt(idx);
  }
  let zeros = 0;
  for (const ch of input) {
    if (ch === '1') zeros++;
    else break;
  }
  if (num === 0n) return new Uint8Array(zeros);
  let hex = num.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const bytes = Buffer.from(hex, 'hex');
  return new Uint8Array(Buffer.concat([Buffer.alloc(zeros), bytes]));
}

export function isValidBase58Pubkey(value: string): boolean {
  if (value.length < 32 || value.length > 88) return false;
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}

// ── amounts and URIs ────────────────────────────────────────────────────────

/** USDC is 1:1 with USD: exact integer math, cents → base units. */
export function baseUnitsForUsdCents(usdCents: number, decimals: number): bigint {
  if (!Number.isInteger(usdCents) || usdCents <= 0) throw new Error('usdCents must be a positive integer');
  if (decimals < 2) throw new Error('decimals must be >= 2');
  return BigInt(usdCents) * 10n ** BigInt(decimals - 2);
}

/** SOL quote: lamports = round(usd / spotPrice * 1e9), computed on scaled integers so it is deterministic. */
export function solLamportsForUsdCents(usdCents: number, solPriceUsd: number): bigint {
  if (!Number.isInteger(usdCents) || usdCents <= 0) throw new Error('usdCents must be a positive integer');
  if (!Number.isFinite(solPriceUsd) || solPriceUsd <= 0) throw new Error('solPriceUsd must be positive');
  const numerator = BigInt(usdCents) * 10n ** 13n; // usdCents * 1e7 (usd→lamports scale) * 1e6 (price scale)
  const priceScaled = BigInt(Math.round(solPriceUsd * 1e6));
  // round half up on integers: floor((2n + d) / (2d))
  return (numerator * 2n + priceScaled) / (priceScaled * 2n);
}

/** Renders base units as a minimal UI decimal string (trailing zeros trimmed). */
export function formatUiAmount(units: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const frac = units % base;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

export function buildSolanaPayUri(params: {
  address: string;
  /** UI-unit decimal string, e.g. "0.064723105" (SOL, 9dp) or "9" (USDC, 6dp). */
  amount: string;
  ref: string;
  splTokenMint?: string;
}): string {
  const query = [`amount=${params.amount}`];
  if (params.splTokenMint) query.push(`spl-token=${params.splTokenMint}`);
  query.push('label=Achiote');
  query.push(`memo=${params.ref}`);
  return `solana:${params.address}?${query.join('&')}`;
}

export function generateCryptoRef(pick: () => number = () => randomInt(CRYPTO_REF_CHARSET.length)): string {
  let ref = '';
  for (let i = 0; i < CRYPTO_REF_LENGTH; i++) ref += CRYPTO_REF_CHARSET[pick()];
  return ref;
}

// ── config ─────────────────────────────────────────────────────────────────

export function loadCryptoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CryptoConfig | null {
  const solAddress = env.ACHIOTE_CRYPTO_SOL_ADDRESS?.trim();
  if (!solAddress) return null;
  if (!isValidBase58Pubkey(solAddress)) return null;
  // API-key handoff encrypts the key with ACHIOTE_KEY_ENCRYPTION_KEY (same material as
  // Stripe billing); without it a paid order could never deliver its key, so crypto stays dark.
  const encryptionKey = env.ACHIOTE_KEY_ENCRYPTION_KEY?.trim();
  if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) return null;
  const usdcMint = env.ACHIOTE_CRYPTO_USDC_MINT?.trim() || DEFAULT_USDC_MINT;
  if (!isValidBase58Pubkey(usdcMint)) return null;
  const rpcUrl = env.ACHIOTE_CRYPTO_RPC_URL?.trim() || DEFAULT_RPC_URL;
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { solAddress, usdcMint, rpcUrl };
}

// ── RPC client ─────────────────────────────────────────────────────────────

export interface SignatureInfo {
  signature: string;
  blockTime: number | null;
  err: unknown;
}

export interface SolanaRpc {
  getSignaturesForAddress(address: string, until?: string): Promise<SignatureInfo[]>;
  /** Raw transaction in `json` encoding with maxSupportedTransactionVersion 0. */
  getTransaction(signature: string): Promise<unknown>;
  /** Token account addresses (ATAs) owned by `owner` for `mint`. */
  getTokenAccountsByOwner(owner: string, mint: string): Promise<string[]>;
}

class RpcMethodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpcMethodError';
  }
}

export function createHttpSolanaRpc(
  rpcUrl: string,
  deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}
): SolanaRpc {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch.bind(globalThis) as typeof fetch);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let nextId = 1;

  async function call(method: string, params: unknown[]): Promise<unknown> {
    let lastError: unknown = new Error('rpc unreachable');
    for (let attempt = 0; attempt < RPC_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(RPC_BACKOFF_BASE_MS * 2 ** (attempt - 1));
      try {
        const res = await fetchImpl(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
          signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`rpc http ${res.status}`);
          continue;
        }
        if (!res.ok) throw new Error(`rpc http ${res.status}`);
        const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
        if (json.error) throw new RpcMethodError(`rpc error: ${json.error.message ?? 'unknown'}`);
        return json.result ?? null;
      } catch (err) {
        // Method-level JSON-RPC errors are deterministic: retrying cannot fix them.
        if (err instanceof RpcMethodError) throw err;
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    async getSignaturesForAddress(address: string, until?: string) {
      const result = (await call('getSignaturesForAddress', [
        address,
        { encoding: 'json', until, commitment: 'confirmed' },
      ])) as SignatureInfo[] | null;
      return result ?? [];
    },
    async getTransaction(signature: string) {
      return call('getTransaction', [
        signature,
        { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
      ]);
    },
    async getTokenAccountsByOwner(owner: string, mint: string) {
      const result = (await call('getTokenAccountsByOwner', [
        owner,
        { mint, programId: TOKEN_PROGRAM_ID },
        { encoding: 'jsonParsed' },
      ])) as { value?: Array<{ pubkey: string }> } | null;
      return (result?.value ?? []).map((entry) => entry.pubkey);
    },
  };
}

/** Default SOL spot price source: Jupiter public price API (server-side, cached by the caller). */
export async function fetchSolPriceUsdFromJupiter(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis) as typeof fetch
): Promise<number | null> {
  try {
    const res = await fetchImpl(`${JUPITER_PRICE_URL}?ids=${WSOL_MINT}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, { usdPrice?: unknown }>;
    const price = json[WSOL_MINT]?.usdPrice;
    if (typeof price !== 'number' || !Number.isFinite(price)) return null;
    if (price < SOL_PRICE_MIN_USD || price > SOL_PRICE_MAX_USD) return null;
    return price;
  } catch {
    return null;
  }
}

// ── deterministic transaction analysis ─────────────────────────────────────

interface CompiledInstruction {
  programIdIndex: number;
  accounts: number[];
  data: string;
}

interface RawJsonTransaction {
  blockTime?: number | null;
  meta?: { err?: unknown; loadedAddresses?: { writable?: string[]; readonly?: string[] } } | null;
  transaction?: {
    message?: {
      accountKeys?: string[];
      instructions?: CompiledInstruction[];
    };
  } | null;
}

export interface ObservedTransfer {
  asset: CryptoAsset;
  destination: string;
  amountUnits: bigint;
}

export interface AnalyzedTransaction {
  transfers: ObservedTransfer[];
  memos: string[];
}

function readU64Le(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(bytes[offset + i]);
  return value;
}

/**
 * Extracts every transfer landing on a watched account plus every memo text from a raw
 * `json`-encoded transaction. SOL transfers = System Program `Transfer` (type 2) whose
 * destination key is watched; SPL transfers = Token Program `transfer` (3) /
 * `transferChecked` (12) whose destination token account is watched.
 */
export function analyzeTransaction(tx: unknown, watchedAccounts: Set<string>): AnalyzedTransaction | null {
  if (!tx || typeof tx !== 'object') return null;
  const raw = tx as RawJsonTransaction;
  if (raw.meta && raw.meta.err != null) return null;
  const message = raw.transaction?.message;
  const staticKeys = message?.accountKeys ?? [];
  const loaded = raw.meta?.loadedAddresses;
  const keys = [...staticKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
  const instructions = message?.instructions ?? [];

  const transfers: ObservedTransfer[] = [];
  const memos: string[] = [];

  for (const instruction of instructions) {
    const programId = keys[instruction.programIdIndex];
    if (!programId) continue;
    let data: Uint8Array;
    try {
      data = decodeBase58(instruction.data);
    } catch {
      continue;
    }
    if (MEMO_PROGRAM_IDS.has(programId)) {
      memos.push(Buffer.from(data).toString('utf8'));
      continue;
    }
    if (programId === SYSTEM_PROGRAM_ID && data.length >= 12) {
      const type = (data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0;
      if (type !== 2) continue; // Transfer only
      const destination = keys[instruction.accounts[1]];
      if (destination && watchedAccounts.has(destination)) {
        transfers.push({ asset: 'sol', destination, amountUnits: readU64Le(data, 4) });
      }
      continue;
    }
    if (programId === TOKEN_PROGRAM_ID && data.length >= 9) {
      const discriminator = data[0];
      let destinationIndex: number | undefined;
      if (discriminator === 3 && data.length === 9) destinationIndex = instruction.accounts[1]; // transfer: [source, dest, authority]
      else if (discriminator === 12 && data.length === 10) destinationIndex = instruction.accounts[2]; // transferChecked: [source, mint, dest, authority] — u8 discriminator + u64 amount + u8 decimals
      else continue;
      const destination = destinationIndex === undefined ? undefined : keys[destinationIndex];
      if (destination && watchedAccounts.has(destination)) {
        transfers.push({ asset: 'usdc', destination, amountUnits: readU64Le(data, 1) });
      }
    }
  }

  return { transfers, memos };
}

export interface OrderView {
  ref: string;
  asset: CryptoAsset;
  amountUnits: bigint;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface OrderMatch {
  ref: string;
  transfer: ObservedTransfer;
  reason: 'memo' | 'amount';
}

/**
 * Match rules (deterministic, oldest order first):
 *  (a) any memo in the transaction contains the order's ref, AND the transaction carries
 *      a transfer of that order's asset to a watched account → credit by memo;
 *  (b) when no memo matched the order: an exact-amount transfer of the right asset to a
 *      watched account, with the chain blockTime inside the order window (± clock slack).
 * Each individual transfer credits at most one order.
 */
export function matchTransaction(params: {
  analyzed: AnalyzedTransaction;
  orders: OrderView[];
  blockTimeMs: number | null;
}): OrderMatch[] {
  const { analyzed, blockTimeMs } = params;
  // Oldest first regardless of caller order: deterministic claiming when two pending
  // orders could match the same transfer.
  const orders = [...params.orders].sort((a, b) => a.createdAtMs - b.createdAtMs);
  const matches: OrderMatch[] = [];
  const claimed = new Set<ObservedTransfer>();

  const claimTransfer = (order: OrderView): ObservedTransfer | null => {
    const transfer = analyzed.transfers.find((t) => t.asset === order.asset && !claimed.has(t));
    if (!transfer) return null;
    claimed.add(transfer);
    return transfer;
  };

  for (const order of orders) {
    if (analyzed.memos.some((memo) => memo.includes(order.ref))) {
      const transfer = claimTransfer(order);
      if (transfer) matches.push({ ref: order.ref, transfer, reason: 'memo' });
    }
  }

  if (blockTimeMs === null) return matches;
  for (const order of orders) {
    if (matches.some((m) => m.ref === order.ref)) continue;
    if (blockTimeMs + WINDOW_SLACK_MS < order.createdAtMs) continue;
    if (blockTimeMs - WINDOW_SLACK_MS > order.expiresAtMs) continue;
    const transfer = claimTransfer(order);
    if (transfer && transfer.amountUnits === order.amountUnits) {
      matches.push({ ref: order.ref, transfer, reason: 'amount' });
    } else if (transfer) {
      claimed.delete(transfer); // wrong amount: release for a later order
    }
  }

  return matches;
}

// ── checkout ───────────────────────────────────────────────────────────────

export interface CryptoCheckoutDeps {
  rpc?: SolanaRpc;
  fetchSolPriceUsd?: () => Promise<number | null>;
  now?: () => number;
  pollIntervalMs?: number;
  log?: (message: string) => void;
}

export interface CryptoOrderResponse {
  ref: string;
  asset: CryptoAsset;
  address: string;
  amount: string;
  uri: string;
  expiresAtMs: number;
}

export function cryptoSessionId(ref: string): string {
  return `crypto:${ref}`;
}

export class CryptoCheckout {
  private readonly rpc: SolanaRpc;
  private readonly fetchSolPriceUsd: () => Promise<number | null>;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly lastSeenSignature = new Map<string, string>();
  private priceCache: { value: number | null; at: number } = { value: null, at: 0 };

  constructor(
    private readonly config: CryptoConfig,
    private readonly billingDb: BillingDb,
    deps: CryptoCheckoutDeps = {}
  ) {
    this.rpc = deps.rpc ?? createHttpSolanaRpc(config.rpcUrl);
    this.fetchSolPriceUsd = deps.fetchSolPriceUsd ?? (() => fetchSolPriceUsdFromJupiter());
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? ((message) => console.warn(message));
    this.pollIntervalMs = deps.pollIntervalMs ?? 20_000;
  }

  get solAddress(): string {
    return this.config.solAddress;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tickSafely(), this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async createOrder(params: { tier: string; mode: 'subscription' | 'payment'; asset: CryptoAsset }): Promise<CryptoOrderResponse> {
    const usdCents = priceUsdCentsForTier(params.tier, params.mode);
    if (usdCents === null) {
      throw new CryptoOrderError(
        400,
        params.mode === 'subscription'
          ? 'Invalid tier for subscription. Use personal or family.'
          : 'Invalid tier for one-time payment. Use memory-pack or family-sprint.'
      );
    }

    let amountUnits: bigint;
    if (params.asset === 'usdc') {
      amountUnits = baseUnitsForUsdCents(usdCents, USDC_DECIMALS); // 1 USDC = $1 exactly
    } else {
      const price = await this.solPriceUsd();
      if (price === null) throw new CryptoOrderError(503, 'quote-unavailable');
      amountUnits = solLamportsForUsdCents(usdCents, price);
    }
    if (amountUnits <= 0n) throw new CryptoOrderError(503, 'quote-unavailable');

    const createdAtMs = this.now();
    const expiresAtMs = createdAtMs + CRYPTO_ORDER_TTL_MS;
    const createdAt = new Date(createdAtMs).toISOString();
    const expiresAt = new Date(expiresAtMs).toISOString();

    let ref = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateCryptoRef();
      if (!this.billingDb.getCryptoOrder(candidate)) {
        ref = candidate;
        break;
      }
    }
    if (!ref) throw new CryptoOrderError(500, 'Could not allocate an order reference');

    this.billingDb.createCryptoOrder({
      ref,
      tier: params.tier,
      mode: params.mode,
      asset: params.asset,
      amountUnits: amountUnits.toString(),
      usdCents,
      address: this.config.solAddress,
      createdAt,
      expiresAt,
    });
    // The pending checkout session lets billing-success.html poll /billing/session for the key.
    if (params.mode === 'subscription') {
      this.billingDb.createCheckoutSession(cryptoSessionId(ref), params.mode, undefined, params.tier as Tier);
    } else {
      this.billingDb.createCheckoutSession(cryptoSessionId(ref), params.mode);
    }

    const decimals = params.asset === 'sol' ? SOL_DECIMALS : USDC_DECIMALS;
    const amount = formatUiAmount(amountUnits, decimals);
    const uri = buildSolanaPayUri({
      address: this.config.solAddress,
      amount,
      ref,
      splTokenMint: params.asset === 'usdc' ? this.config.usdcMint : undefined,
    });
    return { ref, asset: params.asset, address: this.config.solAddress, amount, uri, expiresAtMs };
  }

  async getOrderStatus(ref: string): Promise<{ status: 'pending' | 'paid' | 'expired'; sessionId: string }> {
    const expired = this.billingDb.expireStaleCryptoOrders(new Date(this.now()).toISOString());
    if (expired > 0) this.log(`[crypto] expired ${expired} stale order(s)`);
    const order = this.billingDb.getCryptoOrder(ref);
    if (!order) throw new CryptoOrderError(404, 'Order not found');
    return { status: order.status, sessionId: cryptoSessionId(order.ref) };
  }

  private async tickSafely(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.tick();
    } catch (err) {
      this.log(`[crypto] poll tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  /** One poll cycle: expire stale orders, then watch the receive address (SOL) and its USDC token accounts. */
  async tick(): Promise<void> {
    const nowIso = new Date(this.now()).toISOString();
    const expired = this.billingDb.expireStaleCryptoOrders(nowIso);
    if (expired > 0) this.log(`[crypto] expired ${expired} stale order(s)`);

    const pending = this.billingDb.listPendingCryptoOrders();
    if (pending.length === 0) return;

    const solOrders = pending.filter((o) => o.asset === 'sol');
    const usdcOrders = pending.filter((o) => o.asset === 'usdc');

    if (solOrders.length > 0) {
      await this.pollWatchedAddress(this.config.solAddress, solOrders);
    }
    if (usdcOrders.length > 0) {
      // SPL transfers land in token accounts owned by the receive address (wallets create
      // the ATA per the Solana Pay spec), so those are the accounts we must watch.
      const tokenAccounts = await this.rpc.getTokenAccountsByOwner(this.config.solAddress, this.config.usdcMint);
      for (const account of tokenAccounts.slice(0, MAX_TOKEN_ACCOUNTS_WATCHED)) {
        await this.pollWatchedAddress(account, usdcOrders);
      }
    }
  }

  private async pollWatchedAddress(address: string, orders: CryptoOrderRecord[]): Promise<void> {
    if (orders.length === 0) return;
    const signatures = await this.rpc.getSignaturesForAddress(address, this.lastSeenSignature.get(address));
    // Oldest first so credits apply chronologically.
    for (const sig of [...signatures].reverse()) {
      if (sig.err != null) continue;
      let tx: unknown;
      try {
        tx = await this.rpc.getTransaction(sig.signature);
      } catch (err) {
        this.log(`[crypto] getTransaction failed for ${sig.signature.slice(0, 16)}…: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (!tx) continue;
      const analyzed = analyzeTransaction(tx, new Set([address]));
      if (!analyzed) continue;
      const blockTimeMs =
        typeof (tx as RawJsonTransaction).blockTime === 'number'
          ? ((tx as RawJsonTransaction).blockTime as number) * 1000
          : typeof sig.blockTime === 'number'
            ? sig.blockTime * 1000
            : null;
      const matches = matchTransaction({
        analyzed,
        orders: orders.map((o) => ({
          ref: o.ref,
          asset: o.asset,
          amountUnits: BigInt(o.amountUnits),
          createdAtMs: Date.parse(o.createdAt),
          expiresAtMs: Date.parse(o.expiresAt),
        })),
        blockTimeMs,
      });
      for (const match of matches) {
        const order = orders.find((o) => o.ref === match.ref);
        if (order) await this.credit(order, sig.signature, match.reason);
      }
    }
    if (signatures.length > 0) {
      this.lastSeenSignature.set(address, signatures[0].signature);
    }
  }

  private async credit(order: CryptoOrderRecord, signature: string, reason: 'memo' | 'amount'): Promise<void> {
    const claimed = this.billingDb.markCryptoOrderPaid(order.ref, signature);
    if (!claimed) return;
    try {
      this.fulfill(order);
      this.log(`[crypto] order ${order.ref} paid (${reason}) via ${signature.slice(0, 16)}…`);
    } catch (err) {
      // Fulfillment failed after payment: reopen so the next tick retries activation.
      this.billingDb.reopenCryptoOrder(order.ref);
      this.log(`[crypto] fulfillment failed for ${order.ref}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Mirrors BillingStripe.handleCheckoutCompleted: same tables, same key generation, same
   * checkout-session completion — only the payment rail differs.
   */
  private fulfill(order: CryptoOrderRecord): void {
    const sessionId = cryptoSessionId(order.ref);
    const customerId = `crypto:${order.ref}`;
    if (this.billingDb.getCheckoutSession(sessionId)?.status === 'completed') return;

    this.billingDb.upsertCustomer(customerId, null);

    if (order.mode === 'subscription') {
      const tier = this.tierFromOrder(order.tier);
      const subscriptionId = `crypto-sub:${order.ref}`;
      const nowMs = this.now();
      this.billingDb.upsertSubscription({
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: customerId,
        tier,
        status: 'active',
        currentPeriodEnd: nowMs + CRYPTO_SUB_PERIOD_MS,
        createdAt: new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
      });
      const { key, keyId } = this.billingDb.generateAndStoreApiKey(tier, `Crypto: ${tier}`, customerId, subscriptionId);
      this.billingDb.completeCheckoutSession(sessionId, customerId, keyId, key, tier);
      return;
    }

    const offer = this.paymentOfferFromOrder(order.tier);
    const credits = PAYMENT_OFFER_CREDITS[offer];
    this.billingDb.addCredits(customerId, credits.mcp, credits.web);
    const { key, keyId } = this.billingDb.generateAndStoreApiKey('free', PAYMENT_OFFER_KEY_NAMES[offer], customerId);
    this.billingDb.completeCheckoutSession(sessionId, customerId, keyId, key, 'free');
  }

  private tierFromOrder(value: string): Tier {
    if (value === 'personal' || value === 'family') return value;
    return 'personal';
  }

  private paymentOfferFromOrder(value: string): CheckoutPaymentOffer {
    return value === 'family-sprint' ? 'family-sprint' : 'memory-pack';
  }

  private async solPriceUsd(): Promise<number | null> {
    const nowMs = this.now();
    if (this.priceCache.value !== null && nowMs - this.priceCache.at < PRICE_CACHE_TTL_MS) {
      return this.priceCache.value;
    }
    const price = await this.fetchSolPriceUsd();
    if (price !== null) this.priceCache = { value: price, at: nowMs };
    return price;
  }
}
