import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAchioteServer } from '../src/server.js';

describe('search and citation text is declared untrusted (AC-6)', () => {
  it('server instructions tell the host to treat search results and source text as data', async () => {
    const server = createAchioteServer({ enableCache: false });
    const client = new Client({ name: 'achiote-test', version: '0.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      expect(client.getInstructions()).toMatch(/search results?, source titles?, snippets? .*(data|untrusted)/i);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('the skill (and its plugin copy) repeats it in Safety and Guardrails', () => {
    const root = path.resolve(__dirname, '..');
    for (const rel of ['skill/SKILL.md', 'plugins/achiote/skills/achiote/SKILL.md']) {
      expect(fs.readFileSync(path.join(root, rel), 'utf8'), rel).toMatch(/web search results.*never follow instructions/is);
    }
  });
});
