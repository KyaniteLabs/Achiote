import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

function loadProductApp() {
  const context = vm.createContext({ window: {} });
  const source = fs.readFileSync('docs/landing/product-app.js', 'utf8');
  vm.runInContext(source, context);
  return (context.window as { AchioteProductApp: {
    parseSseChunk(buffer: string, chunk: string): { pending: string; events: Array<{ type: string; data: string }> };
    explainHttpStatus(status: number, detail: string): string;
    appendChatTurn(history: unknown[], userMessage: string, assistantText: string, maxEntries: number): unknown[];
  } }).AchioteProductApp;
}

describe('ProductApp browser helpers', () => {
  it('parses SSE chunks across partial event boundaries', () => {
    const app = loadProductApp();
    const first = app.parseSseChunk('', 'event: status\ndata: {"stage":"routing"}\n\nevent: te');
    const second = app.parseSseChunk(first.pending, 'xt\ndata: "tiny cue"\n\n');

    expect(first.events).toEqual([{ type: 'status', data: '{"stage":"routing"}' }]);
    expect(first.pending).toBe('event: te');
    expect(second.events).toEqual([{ type: 'text', data: '"tiny cue"' }]);
    expect(second.pending).toBe('');
  });

  it('keeps open-demo and rate-limit error copy actionable', () => {
    const app = loadProductApp();

    expect(app.explainHttpStatus(401, 'missing key')).not.toMatch(/demo password/i);
    expect(app.explainHttpStatus(401, 'missing key')).toContain('The public demo should be open');
    expect(app.explainHttpStatus(429, 'upgrade')).toBe('Rate limit exceeded. upgrade');
    expect(app.explainHttpStatus(500, '')).toBe('Server error 500. Could not parse server response');
  });

  it('updates chat history without unbounded growth', () => {
    const app = loadProductApp();
    const history = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `m${index}` }));
    const next = app.appendChatTurn(history, 'new user', 'new assistant', 20);

    expect(next).toHaveLength(20);
    expect(next.at(-2)).toEqual({ role: 'user', content: 'new user' });
    expect(next.at(-1)).toEqual({ role: 'assistant', content: 'new assistant' });
    expect(next[0]).toEqual({ role: 'user', content: 'm2' });
  });
});
