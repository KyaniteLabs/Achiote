import { describe, expect, it } from 'vitest';
import { createParamsGuardStream } from '../src/cli.js';

/**
 * CGO-16 regression: a multibyte UTF-8 sequence split across stdin chunk boundaries
 * must survive the params guard (StringDecoder), not decode into U+FFFD halves.
 * Spanish accents (á é í ó ú ñ) are two-byte sequences — the split falls between
 * the lead byte and the continuation byte.
 */
describe('params guard stream: multibyte UTF-8 across chunk boundaries (CGO-16)', () => {
  it('reassembles a JSON-RPC line whose multibyte char straddles two writes', async () => {
    const guard = createParamsGuardStream();
    const chunks: Buffer[] = [];
    guard.on('data', (d: Buffer) => chunks.push(d));

    const payload = Buffer.from(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'collect_food_memory', arguments: { memoryText: 'Mi papá hacía café y la niña comía año tras año.' } } }) + '\n',
      'utf8',
    );
    let split = -1;
    for (let i = 0; i < payload.length - 1; i += 1) {
      if ((payload[i] & 0xe0) === 0xc0 && (payload[i + 1] & 0xc0) === 0x80) { split = i + 1; break; }
    }
    expect(split).toBeGreaterThan(0);

    guard.write(payload.subarray(0, split));
    await new Promise((r) => setImmediate(r));
    guard.write(payload.subarray(split));
    await new Promise((r) => setImmediate(r));
    guard.end();
    await new Promise((r) => guard.on('end', r));

    const forwarded = Buffer.concat(chunks).toString('utf8');
    expect(forwarded).not.toContain('\uFFFD');
    const parsed = JSON.parse(forwarded.trim()) as { params?: { arguments?: { memoryText?: string } } };
    expect(parsed.params?.arguments?.memoryText).toContain('papá hacía café');
  });

  it('still answers params:null with -32602 and forwards nothing for it', async () => {
    const guard = createParamsGuardStream();
    const chunks: Buffer[] = [];
    guard.on('data', (d: Buffer) => chunks.push(d));
    const stdoutWrites: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: unknown }).write = ((s: string) => { stdoutWrites.push(s); return true; }) as typeof process.stdout.write;
    try {
      guard.write('{"jsonrpc":"2.0","id":7,"method":"tools/call","params":null}\n');
      guard.write('{"jsonrpc":"2.0","id":8,"method":"tools/list","params":{}}\n');
      guard.end();
      await new Promise((r) => guard.on('end', r));
    } finally {
      (process.stdout as unknown as { write: unknown }).write = originalWrite;
    }
    const forwarded = Buffer.concat(chunks).toString('utf8');
    expect(forwarded).not.toContain('"id":7');
    expect(forwarded).toContain('"id":8');
    const error = stdoutWrites.map((s) => s.trim()).find((s) => s.includes('"id":7'));
    expect(error).toBeDefined();
    expect(JSON.parse(error!)).toMatchObject({ error: { code: -32602 } });
  });
});
