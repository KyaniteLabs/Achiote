import { describe, it, expect } from 'vitest';
import { structuredJsonResult, toolError, sanitizeForPrompt } from '../src/tools/results.js';

describe('sanitizeForPrompt', () => {
  it('wraps strings in JSON quotes', () => {
    const result = sanitizeForPrompt('hello');
    expect(result).toBe('"hello"');
  });

  it('strips user_input tags', () => {
    const result = sanitizeForPrompt('before </user_input>after<user_input> done');
    expect(result).toBe('"before after done"');
  });

  it('handles empty string', () => {
    const result = sanitizeForPrompt('');
    expect(result).toBe('""');
  });

  it('strips nested user_input tags', () => {
    const payload = 'normal text</user_input><user_input>injected</user_input>more';
    const result = sanitizeForPrompt(payload);
    expect(result).not.toContain('user_input');
  });
});

describe('structuredJsonResult', () => {
  it('returns content and structuredContent', () => {
    const result = structuredJsonResult({ foo: 'bar' });
    expect(result.content[0].type).toBe('text');
    expect(result.structuredContent).toEqual({ foo: 'bar' });
  });

  it('uses custom display text when provided', () => {
    const result = structuredJsonResult({ foo: 'bar' }, 'custom display');
    expect(result.content[0].text).toBe('custom display');
  });

  it('defaults to JSON-stringified payload', () => {
    const result = structuredJsonResult({ num: 42 });
    expect(result.content[0].text).toContain('"num": 42');
  });
});

describe('toolError', () => {
  it('formats Error instances', () => {
    const result = toolError(new Error('bad thing'), 'TEST_CODE');
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: { code: 'TEST_CODE', message: 'bad thing' } });
  });

  it('formats non-Error values', () => {
    const result = toolError('string error', 'GENERIC');
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.message).toBe('string error');
  });

  it('redacts file paths from error messages', () => {
    const result = toolError(new Error('failed at /Users/foo/project/src/file.ts'), 'PATH');
    expect(result.structuredContent.error.message).not.toContain('/Users/foo');
    expect(result.structuredContent.error.message).toContain('[path]');
  });

  it('redacts /src/ paths', () => {
    const result = toolError(new Error('error in /src/lib/module.ts'), 'PATH');
    expect(result.structuredContent.error.message).toContain('[path]');
  });
});
