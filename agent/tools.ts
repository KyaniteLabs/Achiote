import { MCPClient } from '@mastra/mcp';

export function createAchioteMcpClient(baseUrl = 'http://localhost:3000') {
  return new MCPClient({
    id: 'achiote-mcp',
    servers: {
      achiote: {
        url: new URL(`${baseUrl}/mcp`),
      },
    },
  });
}
