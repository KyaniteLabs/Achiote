import { describe, expect, it } from 'vitest';
import { createAchioteServer } from '../src/server.js';
import { runAchioteStdioServer } from '../src/cli.js';
import * as publicApi from '../src/index.js';

describe('module boundaries', () => {
  it('keeps server construction and stdio runner available from focused modules', () => {
    expect(typeof createAchioteServer).toBe('function');
    expect(typeof runAchioteStdioServer).toBe('function');
  });

  it('keeps the package public entrypoint backward compatible', () => {
    expect(publicApi.createAchioteServer).toBe(createAchioteServer);
    expect(publicApi.runAchioteStdioServer).toBe(runAchioteStdioServer);
  });
});
