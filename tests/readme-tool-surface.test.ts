import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAchioteServer } from '../src/index.js';

// Guards the README tool table against drift from the registered surface.
// The README is the first thing a seat reads; it once claimed "18 MCP tools"
// and never named reconstruct_food_memory while the live server answered
// tools/list with 19. This test pins the README table to what the server
// actually registers, so a renamed, added, or removed tool fails here unless
// the README is updated in the same change.

const TOOL_TABLE_HEADER = '| Stage | Tool | Implemented behavior |';

function readmeToolTableNames(): string[] {
  const readme = fs.readFileSync('README.md', 'utf8');
  const lines = readme.split('\n');
  const headerIndex = lines.indexOf(TOOL_TABLE_HEADER);
  if (headerIndex === -1) {
    throw new Error('README.md no longer contains the "Stage | Tool | Implemented behavior" tool table');
  }

  const names = new Set<string>();
  for (const row of lines.slice(headerIndex + 1)) {
    if (!row.startsWith('|')) break; // table ended
    const columns = row.split('|');
    const toolColumn = columns[2] ?? '';
    // Rows may list several tools separated by " / "; every name is backticked.
    for (const match of toolColumn.matchAll(/`([a-z][a-z0-9_]*)`/g)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

describe('README tool-surface guard', () => {
  it('documents exactly the tools the server reports on tools/list', async () => {
    const server = createAchioteServer({ enableCache: false });
    const client = new Client({ name: 'achiote-readme-guard', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    let liveNames: string[];
    try {
      const { tools } = await client.listTools();
      liveNames = tools.map((tool) => tool.name).sort();
    } finally {
      await client.close();
      await server.close();
    }

    const documented = readmeToolTableNames();
    expect(
      documented,
      'README tool table must match tools/list exactly (no missing tools, no phantom tools)',
    ).toEqual(liveNames);
  });

  it('states the live tool count in the README headline', async () => {
    const server = createAchioteServer({ enableCache: false });
    const client = new Client({ name: 'achiote-readme-guard', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    let liveCount: number;
    try {
      const { tools } = await client.listTools();
      liveCount = tools.length;
    } finally {
      await client.close();
      await server.close();
    }

    const readme = fs.readFileSync('README.md', 'utf8');
    expect(readme).toContain(`It provides ${liveCount} MCP tools`);
  });
});
