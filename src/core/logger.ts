/**
 * Structured logger abstraction for the ask engine and its surfaces.
 *
 * The engine used to log diagnostics via bare `console.log`/`console.warn` to stdout, which forced the
 * CLI to monkey-patch `console.log` so its `--json` stdout stayed clean. That hack is replaced by this
 * injectable `Logger`: the engine logs through `deps.logger`, and each surface picks the sink it needs.
 *
 *   - HTTP server  -> a JSON-stderr logger (diagnostics never touch the SSE stream on stdout/the socket).
 *   - CLI          -> a logger that writes to STDERR, so stdout stays clean for `--json` without patching.
 *   - MCP stdio    -> a no-op (quiet) logger, because the stdio transport owns stdout AND stderr framing.
 *
 * Levels are debug/info/warn/error. The default JSON logger writes a single structured line per call to
 * a chosen stream (stderr by default) and respects a minimum level so noisy `debug`/`info` can be muted
 * in production without changing call sites.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** A logger that does nothing. Used by the MCP stdio surface, where any stray write corrupts framing. */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export type JsonLoggerOptions = {
  /** Where structured lines are written. Defaults to process.stderr so stdout stays clean. */
  stream?: NodeJS.WritableStream;
  /** Minimum level to emit. Calls below this level are dropped. Defaults to 'info'. */
  minLevel?: LogLevel;
  /** Optional component tag added to every record (e.g. 'ask', 'http'). */
  component?: string;
};

/**
 * Build a logger that writes one JSON object per call to `stream` (process.stderr by default). The shape
 * is `{ level, ts, msg, ...fields }` plus an optional `component`. Writing to stderr keeps stdout free
 * for the CLI's `--json` payload and the HTTP SSE stream.
 */
export function createJsonLogger(options: JsonLoggerOptions = {}): Logger {
  const stream = options.stream ?? process.stderr;
  const minLevel = LEVEL_ORDER[options.minLevel ?? 'info'];
  const component = options.component;

  const write = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < minLevel) return;
    const record: Record<string, unknown> = {
      level,
      ts: new Date().toISOString(),
      ...(component ? { component } : {}),
      msg: message,
      ...(fields ?? {}),
    };
    try {
      stream.write(`${JSON.stringify(record)}\n`);
    } catch {
      // A logger must never throw into the request path; drop the line if the sink rejects it.
    }
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

/**
 * A logger that writes plain (non-JSON) text lines to a stream, prefixed by level. Used by the CLI so
 * its STDERR progress/diagnostics read naturally for a human while stdout stays clean for `--json`.
 */
export function createTextLogger(stream: NodeJS.WritableStream, minLevel: LogLevel = 'info'): Logger {
  const threshold = LEVEL_ORDER[minLevel];
  const write = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
    try {
      stream.write(`${message}${suffix}\n`);
    } catch {
      // Never throw from a log call.
    }
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

/** The engine's default logger when a surface does not inject one: JSON to stderr at info level. */
export const defaultEngineLogger: Logger = createJsonLogger({ component: 'ask' });
