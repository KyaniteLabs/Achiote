import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFreePort } from './helpers/ports.js';
import { BillingDb } from '../src/lib/billing-db.js';
import { CryptoCheckout, type SolanaRpc } from '../src/lib/billing-crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENCRYPTION_KEY = '1'.repeat(64);
// The system program id is a valid base58 32-byte key, which is all the config validates.
const RECEIVE_ADDRESS = '11111111111111111111111111111111';
const DEAD_RPC = 'http://127.0.0.1:9';

async function waitForServer(server: ChildProcess, port: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 15000);
    server.stdout!.on('data', (data: Buffer) => {
      if (data.toString().includes(`localhost:${port}`)) {
        clearTimeout(timeout);
        resolvePromise();
      }
    });
    server.stderr!.on('data', (data: Buffer) => {
      if (data.toString().includes('EADDRINUSE')) {
        clearTimeout(timeout);
        reject(new Error(`Port ${port} already in use`));
      }
    });
    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe('crypto checkout HTTP surface (unconfigured)', () => {
  let server: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn('node', [resolve(ROOT, 'dist/http-server.js')], {
      env: { ...process.env, PORT: String(port), ACHIOTE_AUTH_ENABLED: 'false', ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    await waitForServer(server, port);
  }, 20000);

  afterAll(() => {
    server?.kill('SIGINT');
  });

  it('reports cryptoEnabled false on /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cryptoEnabled).toBe(false);
  });

  it('returns 503 with the documented error for order creation', async () => {
    const res = await fetch(`${baseUrl}/billing/crypto-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'personal', mode: 'subscription', asset: 'usdc' }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Crypto payments not configured' });
  });

  it('returns 503 for status lookups too', async () => {
    const res = await fetch(`${baseUrl}/billing/crypto-status?ref=AB2CD3EF`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Crypto payments not configured' });
  });
});

describe('crypto checkout HTTP surface (configured)', () => {
  let server: ChildProcess;
  let baseUrl: string;
  let dbDir: string;
  let billingDb: BillingDb;

  beforeAll(async () => {
    // The test process fulfills orders against the same DB the server reads; key storage
    // encrypts with the same env material the server was spawned with.
    process.env.ACHIOTE_KEY_ENCRYPTION_KEY = ENCRYPTION_KEY;
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    dbDir = mkdtempSync(join(tmpdir(), 'achiote-crypto-http-'));
    server = spawn('node', [resolve(ROOT, 'dist/http-server.js')], {
      env: {
        ...process.env,
        PORT: String(port),
        ACHIOTE_AUTH_ENABLED: 'false',
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false',
        ACHIOTE_CRYPTO_SOL_ADDRESS: RECEIVE_ADDRESS,
        ACHIOTE_KEY_ENCRYPTION_KEY: ENCRYPTION_KEY,
        ACHIOTE_CRYPTO_RPC_URL: DEAD_RPC,
        ACHIOTE_BILLING_DB: join(dbDir, 'billing.db'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    await waitForServer(server, port);
    billingDb = new BillingDb(join(dbDir, 'billing.db'));
  }, 20000);

  afterAll(() => {
    server?.kill('SIGINT');
    billingDb?.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it('reports cryptoEnabled true on /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    expect(body.cryptoEnabled).toBe(true);
  });

  it('creates a USDC order at exact USD parity with a Solana Pay URI', async () => {
    const res = await fetch(`${baseUrl}/billing/crypto-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'personal', mode: 'subscription', asset: 'usdc' }),
    });
    expect(res.status).toBe(200);
    const order = await res.json();
    expect(order.asset).toBe('usdc');
    expect(order.address).toBe(RECEIVE_ADDRESS);
    expect(order.amount).toBe('9');
    expect(order.uri).toBe(`solana:${RECEIVE_ADDRESS}?amount=9&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&label=Achiote&memo=${order.ref}`);
    expect(order.ref).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
    expect(order.expiresAtMs).toBeGreaterThan(Date.now());

    const status = await (await fetch(`${baseUrl}/billing/crypto-status?ref=${order.ref}`)).json();
    expect(status).toEqual({ status: 'pending' });

    // The pending checkout session lets billing-success.html poll for the key.
    const session = await fetch(`${baseUrl}/billing/session?session_id=crypto:${order.ref}`);
    expect(session.status).toBe(202);
    expect(await session.json()).toMatchObject({ status: 'pending' });
  });

  it('validates asset, ref, and unknown refs', async () => {
    const badAsset = await fetch(`${baseUrl}/billing/crypto-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'personal', mode: 'subscription', asset: 'btc' }),
    });
    expect(badAsset.status).toBe(400);

    const annual = await fetch(`${baseUrl}/billing/crypto-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'personal', mode: 'subscription', billing: 'annual' }),
    });
    expect(annual.status).toBe(400);
    expect(await annual.json()).toMatchObject({ error: 'Annual billing is not supported for crypto checkout.' });

    const badRef = await fetch(`${baseUrl}/billing/crypto-status?ref=00O0II11`);
    expect(badRef.status).toBe(400);

    const unknown = await fetch(`${baseUrl}/billing/crypto-status?ref=AB2CD3EF`);
    expect(unknown.status).toBe(404);
  });

  it('delivers the API key through /billing/session after the poller credits a payment (cross-process)', async () => {
    const res = await fetch(`${baseUrl}/billing/crypto-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'memory-pack', mode: 'payment', asset: 'usdc' }),
    });
    const order = await res.json();
    expect(order.amount).toBe('49');

    // Fulfill from the test process against the same billing DB: the fake RPC reports a
    // memo-matched USDC transfer to the watched token account.
    const tx = splMemoTransferTx({ amount: 49_000_000n, memo: order.ref });
    const rpc: SolanaRpc = {
      async getSignaturesForAddress() {
        return [{ signature: 'integration-sig', blockTime: Math.floor(Date.now() / 1000), err: null }];
      },
      async getTransaction() {
        return tx;
      },
      async getTokenAccountsByOwner() {
        return ['TokenAccountDestination1111111111111111111111'];
      },
    };
    const checker = new CryptoCheckout(
      { solAddress: RECEIVE_ADDRESS, usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', rpcUrl: DEAD_RPC },
      billingDb,
      { rpc, log: () => {} }
    );
    await checker.tick();

    const status = await (await fetch(`${baseUrl}/billing/crypto-status?ref=${order.ref}`)).json();
    expect(status).toEqual({ status: 'paid', sessionId: `crypto:${order.ref}` });

    // Crypto sessions skip the email gate: the ref is the proof of purchase.
    const session = await fetch(`${baseUrl}/billing/session?session_id=crypto:${order.ref}`);
    expect(session.status).toBe(200);
    const body = await session.json();
    expect(body.status).toBe('completed');
    expect(body.apiKey).toMatch(/^ach_[a-f0-9]{48}$/);
    expect(body.tier).toBe('free'); // one-time packs ride free-tier keys with purchased credits
  });
});

describe('crypto checkout frontend surface', () => {
  it('vendors a self-hosted QR library with no runtime network calls', () => {
    const vendorPath = resolve(ROOT, 'docs', 'landing', 'vendor', 'qrcode.js');
    expect(existsSync(vendorPath)).toBe(true);
    const source = readFileSync(vendorPath, 'utf8');
    expect(source).toContain('qrcode-generator v1.4.4');
    expect(source).toContain('MIT');
    // No runtime network vectors: comment URLs (upstream attribution) are fine, fetches are not.
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('XMLHttpRequest');
    expect(source).not.toContain('import(');
    expect(source).not.toContain('document.createElement(');
  });

  it('keeps the crypto path hidden until the server reports it configured', () => {
    const indexHtml = readFileSync(resolve(ROOT, 'docs', 'landing', 'index.html'), 'utf8');
    const indexJs = readFileSync(resolve(ROOT, 'docs', 'landing', 'index.js'), 'utf8');
    // Hidden by default in markup; index.js reveals links only when /health says cryptoEnabled.
    expect((indexHtml.match(/crypto-pay-link/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(indexHtml).toContain('crypto-pay-link" href="#pricing" hidden');
    expect(indexJs).toContain("body.cryptoEnabled");
    expect(indexJs).toContain('/billing/crypto-order');
    expect(indexJs).toContain('/billing/crypto-status');
    expect(indexJs).toContain("window.location.href = '/billing/success?session_id='");
    // No inline handlers: CSP stays script-src 'self'.
    expect(indexJs).not.toContain('onclick=');
  });
});

// Minimal fixture: SPL token transfer with memo, matching the json-encoded RPC shape.
function splMemoTransferTx(opts: { amount: bigint; memo: string }): unknown {
  const SENDER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const TOKEN_ACCOUNT = 'TokenAccountDestination1111111111111111111111';
  const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const keys = [SENDER, TOKEN_PROGRAM, TOKEN_ACCOUNT, MEMO_PROGRAM, USDC_MINT];
  return {
    blockTime: Math.floor(Date.now() / 1000),
    meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
    transaction: {
      message: {
        accountKeys: keys,
        instructions: [
          { programIdIndex: 3, accounts: [], data: encodeBase58(new TextEncoder().encode(opts.memo)) },
          { programIdIndex: 1, accounts: [0, 2], data: encodeBase58(new Uint8Array([3, ...u64le(opts.amount)])) },
        ],
      },
    },
  };
}

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

function u64le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}
