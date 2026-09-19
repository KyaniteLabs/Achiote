try { process.loadEnvFile(); } catch { /* no .env file present */ }

import { parseArgs } from 'node:util';
import { Transform } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAchioteServer } from './server.js';
import { runAskCommand } from './cli-ask.js';
import { runPurgeCommand } from './cli-purge.js';

const VERSION = '0.2.1';

const HELP_TEXT = `achiote — nostalgic food-memory reconstruction

Usage:
  achiote ask "<memory>" [--json] [--quiet]   Reconstruct a food memory locally (no server needed)
  achiote serve                               Run the stdio MCP server (default; alias: mcp)
  achiote purge [--yes]                       Delete local on-disk stores (cache/billing/rate-limit)
  achiote --help | -h                         Show this help
  achiote --version                           Show the version

ask options:
  --json        Print only the final structured JSON result (no streamed progress)
  --quiet       Suppress streamed progress; print only the final answer

purge options:
  --yes         Actually delete (default is a dry run that only reports what would be removed)

Achiote never persists raw food memories. "purge" wipes only the local research cache, the billing
database, and the optional rate-limit database (see docs/PRIVACY-RETENTION.md).

The model provider is read from the environment, the same configuration the HTTP server uses
(e.g. ACHIOTE_ASK_PROVIDER, OPENAI_BASE_URL/OPENAI_MODEL/OPENAI_API_KEY, or ANTHROPIC_API_KEY).

Examples:
  achiote ask "My abuela in Oaxaca made mole negro with chilhuacle chiles"
  achiote ask "pastelay my mom steamed in banana leaves" --json
  achiote serve`;

/**
 * JSON-RPC 2.0 leaves `params: null` undefined-behavior; the MCP SDK silently drops such
 * requests instead of answering them. Detect them line-wise, answer each directly with
 * -32602 Invalid params on stdout, and drop the malformed request from the stream.
 */
function jsonRpcNullParamsRequestId(line: string): string | number | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const message = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      typeof message === 'object' &&
      message !== null &&
      message.method !== undefined &&
      message.id !== undefined &&
      message.params === null
    ) {
      return message.id as string | number;
    }
  } catch {
    // Not valid JSON — pass the line through untouched.
  }
  return null;
}

/** Start the stdio MCP server (the original behavior; default when no subcommand is given). */
export async function runAchioteStdioServer(): Promise<void> {
  const server = createAchioteServer();
  let partialLine = '';
  const paramsGuard = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error: Error | null, data: Buffer | string | null) => void): void {
      partialLine += chunk.toString('utf8');
      const lines = partialLine.split('\n');
      partialLine = lines.pop() ?? '';
      const forwarded = lines.filter((line) => {
        const nullParamsId = jsonRpcNullParamsRequestId(line);
        if (nullParamsId !== null) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: nullParamsId,
              error: { code: -32602, message: 'Invalid params: params must be an object, not null' },
            }) + '\n',
          );
          return false;
        }
        return true;
      });
      callback(null, forwarded.length > 0 ? Buffer.from(forwarded.join('\n') + '\n', 'utf8') : null);
    },
    flush(callback: (error: Error | null, data: Buffer | string | null) => void): void {
      if (partialLine.length > 0) {
        const line = partialLine;
        partialLine = '';
        const nullParamsId = jsonRpcNullParamsRequestId(line);
        if (nullParamsId !== null) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: nullParamsId,
              error: { code: -32602, message: 'Invalid params: params must be an object, not null' },
            }) + '\n',
          );
          callback(null, null);
        } else {
          callback(null, Buffer.from(line + '\n', 'utf8'));
        }
      } else {
        callback(null, null);
      }
    },
  });
  process.stdin.pipe(paramsGuard);
  const transport = new StdioServerTransport(paramsGuard);

  process.on('SIGINT', () => {
    void server.close().finally(() => process.exit(0));
  });

  await server.connect(transport);
}

/**
 * Real CLI dispatcher. `serve`/`mcp`/no-args keep the stdio MCP behavior so existing `.mcp.json`
 * configs that run `achiote` with no arguments keep working. `ask` runs the engine locally.
 */
export async function runAchioteCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  // Default (no command) and explicit serve/mcp keep the stdio MCP server.
  if (command === undefined || command === 'serve' || command === 'mcp') {
    await runAchioteStdioServer();
    return 0;
  }

  if (command === 'ask') {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        json: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    });

    if (values.help) {
      process.stdout.write(`${HELP_TEXT}\n`);
      return 0;
    }

    const memory = positionals.join(' ').trim();
    if (!memory) {
      process.stderr.write('Error: provide a memory to reconstruct, e.g. achiote ask "the soup my dad made"\n');
      return 2;
    }

    return runAskCommand({ memory, json: Boolean(values.json), quiet: Boolean(values.quiet) });
  }

  if (command === 'purge') {
    const { values } = parseArgs({
      args: rest,
      options: {
        yes: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    });
    if (values.help) {
      process.stdout.write(`${HELP_TEXT}\n`);
      return 0;
    }
    return runPurgeCommand({ confirm: Boolean(values.yes) });
  }

  process.stderr.write(`Unknown command: ${command}\nRun "achiote --help" for usage.\n`);
  return 2;
}
