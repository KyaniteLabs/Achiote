import type { IncomingMessage, ServerResponse } from 'node:http';
import { achioteAgent } from './index.js';

export async function handleAgentStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let parsed: { message?: string };
  try { parsed = JSON.parse(raw); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const userMessage = parsed.message?.trim();
  if (!userMessage) { sendJson(res, 400, { error: 'message is required' }); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    const stream = await achioteAgent.stream(userMessage);

    for await (const chunk of stream) {
      const text = typeof chunk === 'string' ? chunk : chunk?.text;
      if (text) {
        res.write(`event: text\ndata: ${JSON.stringify(text)}\n\n`);
      }
    }
    res.write('event: done\ndata: {}\n\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
  } finally {
    res.end();
  }
}

function readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) { req.destroy(); reject(new Error('Body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
