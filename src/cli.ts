import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMemberBerriesServer } from './server.js';

export async function runMemberBerriesStdioServer() {
  const server = createMemberBerriesServer();
  const transport = new StdioServerTransport();

  process.on('SIGINT', () => {
    void server.close().finally(() => process.exit(0));
  });

  await server.connect(transport);
}
