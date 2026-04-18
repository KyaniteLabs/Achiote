import { describe, expect, it } from 'vitest';
import { createMemberBerriesServer } from '../src/server.js';
import { runMemberBerriesStdioServer } from '../src/cli.js';
import * as publicApi from '../src/index.js';

describe('module boundaries', () => {
  it('keeps server construction and stdio runner available from focused modules', () => {
    expect(typeof createMemberBerriesServer).toBe('function');
    expect(typeof runMemberBerriesStdioServer).toBe('function');
  });

  it('keeps the package public entrypoint backward compatible', () => {
    expect(publicApi.createMemberBerriesServer).toBe(createMemberBerriesServer);
    expect(publicApi.runMemberBerriesStdioServer).toBe(runMemberBerriesStdioServer);
  });
});
