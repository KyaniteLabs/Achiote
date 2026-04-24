try { process.loadEnvFile(); } catch { /* no .env file present */ }

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAchioteServer } from './server.js';

export async function runAchioteStdioServer() {
  const server = createAchioteServer();
  const transport = new StdioServerTransport();

  process.on('SIGINT', () => {
    void server.close().finally(() => process.exit(0));
  });

  await server.connect(transport);
}
