/**
 * Unit tests for the injectable engine Logger (src/core/logger.ts).
 *
 * The logger replaces the engine's former bare console.log diagnostics (and the CLI's console.log
 * monkey-patch). These tests pin: the no-op logger writes nothing, the JSON logger emits one structured
 * line per call to its chosen stream, level filtering drops lower-priority calls, and the text logger
 * writes human-readable lines. The "writes to the chosen stream, never stdout" contract is what lets the
 * CLI keep stdout clean for --json and the HTTP server keep the SSE stream clean.
 */
import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createJsonLogger, createTextLogger, noopLogger } from '../src/core/logger.js';

function collector(): { stream: Writable; lines: () => string[]; text: () => string } {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) { buf += chunk.toString(); cb(); },
  });
  return { stream, lines: () => buf.split('\n').filter(Boolean), text: () => buf };
}

describe('engine Logger', () => {
  it('noopLogger writes nothing for any level', () => {
    // The MCP stdio surface relies on this: a single stray write corrupts transport framing.
    expect(() => {
      noopLogger.debug('d');
      noopLogger.info('i');
      noopLogger.warn('w');
      noopLogger.error('e');
    }).not.toThrow();
  });

  it('createJsonLogger emits one JSON line per call with level, ts, and msg', () => {
    const sink = collector();
    const logger = createJsonLogger({ stream: sink.stream, minLevel: 'info' });

    logger.info('hello', { tool: 'collect_food_memory' });
    logger.warn('careful');

    const lines = sink.lines();
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.level).toBe('info');
    expect(first.msg).toBe('hello');
    expect(first.tool).toBe('collect_food_memory');
    expect(typeof first.ts).toBe('string');

    const second = JSON.parse(lines[1]);
    expect(second.level).toBe('warn');
    expect(second.msg).toBe('careful');
  });

  it('createJsonLogger drops calls below the minimum level', () => {
    const sink = collector();
    const logger = createJsonLogger({ stream: sink.stream, minLevel: 'warn' });

    logger.debug('drop me');
    logger.info('drop me too');
    logger.warn('keep');
    logger.error('keep');

    const lines = sink.lines();
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).level).toBe('warn');
    expect(JSON.parse(lines[1]).level).toBe('error');
  });

  it('createJsonLogger tags records with the component when provided', () => {
    const sink = collector();
    const logger = createJsonLogger({ stream: sink.stream, component: 'ask', minLevel: 'debug' });

    logger.debug('trace');

    expect(JSON.parse(sink.lines()[0]).component).toBe('ask');
  });

  it('createTextLogger writes plain lines with appended fields', () => {
    const sink = collector();
    const logger = createTextLogger(sink.stream, 'info');

    logger.info('[ask] doing a thing');
    logger.warn('[ask] heads up', { count: 3 });

    const lines = sink.lines();
    expect(lines[0]).toBe('[ask] doing a thing');
    expect(lines[1]).toBe('[ask] heads up {"count":3}');
  });

  it('a failing sink never throws into the caller', () => {
    const throwingStream = new Writable({
      write() { throw new Error('sink exploded'); },
    });
    const logger = createJsonLogger({ stream: throwingStream });
    expect(() => logger.error('boom')).not.toThrow();
  });
});
