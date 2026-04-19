import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMemberBerriesServer } from '../src/index.js';

describe('research provenance MCP tools', () => {
  async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const server = createMemberBerriesServer({ enableCache: false });
    const client = new Client({ name: 'research-provenance-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try { return await run(client); } finally { await client.close(); await server.close(); }
  }

  it('builds, validates, and extracts findings from sourced research facts', async () => {
    await withClient(async (client) => {
      const record = await client.callTool({
        name: 'build_research_record',
        arguments: {
          dishName: 'pasteles',
          query: 'Puerto Rican pasteles banana leaves',
          sources: [{
            title: 'Pasteles Source',
            url: 'https://example.org/pasteles',
            sourceType: 'article',
            accessedAt: '2026-04-18T00:00:00.000Z',
            reliability: 'Medium',
            extractedFacts: ['Pasteles are often wrapped in banana leaves and may use pork with sofrito.'],
          }],
        },
      });
      expect(record.isError).not.toBe(true);
      expect(record.structuredContent).toMatchObject({ confidence: 'Medium' });

      const validation = await client.callTool({ name: 'validate_research_record', arguments: record.structuredContent });
      expect(validation.structuredContent).toEqual({ issues: [] });

      const findings = await client.callTool({ name: 'extract_research_findings', arguments: record.structuredContent });
      expect(findings.structuredContent).toMatchObject({ sourceCount: 1, confidence: 'Medium' });
      expect((findings.structuredContent?.inferredFacts as string[]).join(' ')).toContain('banana leaves');
    });
  });
});
