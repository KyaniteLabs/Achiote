/**
 * `achiote ask` — local-first CLI reconstruction over the shared ask engine.
 *
 * This is a thin adapter: it drives the SAME `runBufferedAsk` / `runAskWorkflow` engine the HTTP and MCP
 * surfaces use, rendering progress to a TTY by default. No HTTP server is started; the model provider is
 * read from env (the same config the server uses). It never reimplements orchestration.
 */
import { runBufferedAsk, type StructuredAskResult } from './core/ask-run-buffer.js';
import { createTextLogger, noopLogger } from './core/logger.js';

export type AskCliOptions = {
  memory: string;
  json: boolean;
  quiet: boolean;
  /** Where progress/render output goes (defaults to process.stderr so stdout stays clean for --json). */
  progress?: NodeJS.WritableStream;
  /** Where the final answer / JSON goes (defaults to process.stdout). */
  out?: NodeJS.WritableStream;
  /** Force the human-readable streaming renderer regardless of TTY detection (used in tests). */
  forceStream?: boolean;
};

function describeToolEvent(event: string, data: unknown): string | undefined {
  if (event === 'status' && data && typeof data === 'object') {
    const stage = (data as { stage?: unknown }).stage;
    const tools = (data as { tools?: unknown }).tools;
    if (stage === 'routing') return 'routing the request through the workflow planner';
    if (stage === 'model' || stage === 'thinking') return 'thinking';
    if (stage === 'calling_tools' && Array.isArray(tools)) return `running ${tools.join(', ')}`;
    if (stage === 'case_file_compacted') return 'compacting the case file before synthesis';
    if (stage === 'deterministic_recovery') return 'recovering deterministically';
    return undefined;
  }
  if (event === 'tool_result' && data && typeof data === 'object') {
    const name = (data as { name?: unknown }).name;
    if (typeof name === 'string') return `done: ${name}`;
  }
  return undefined;
}

function renderProgress(stream: NodeJS.WritableStream, event: string, data: unknown): void {
  if (event === 'text' && typeof data === 'string') return; // final prose printed at the end
  const line = describeToolEvent(event, data);
  if (line) stream.write(`  · ${line}\n`);
  if (event === 'error' && data && typeof data === 'object') {
    const message = (data as { message?: unknown }).message;
    stream.write(`  ! ${typeof message === 'string' ? message : 'engine error'}\n`);
  }
}

function renderHumanResult(out: NodeJS.WritableStream, result: StructuredAskResult): void {
  out.write('\n');
  out.write(result.answer.trim() ? `${result.answer.trim()}\n` : 'No reconstruction was produced.\n');
  if (result.receipt?.firstTinyTasteTest) {
    const test = result.receipt.firstTinyTasteTest;
    out.write(`\nFirst tiny taste test — ${test.title} (${test.estimatedTime})\n  ${test.cue}\n`);
  }
  if (result.status) out.write(`\nStatus: ${result.status}\n`);
  if (result.toolsRun.length > 0) out.write(`Tools run: ${result.toolsRun.join(', ')}\n`);
}

/** Run the `ask` subcommand. Returns the process exit code (0 success, 1 on engine error). */
export async function runAskCommand(options: AskCliOptions): Promise<number> {
  const out = options.out ?? process.stdout;
  const progress = options.progress ?? process.stderr;
  const streamProgress = !options.quiet && !options.json && (options.forceStream ?? Boolean((progress as NodeJS.WriteStream).isTTY));

  if (streamProgress) progress.write('Reconstructing your food memory...\n');

  // The engine logs diagnostics through an injected Logger (no console.log monkey-patching). In quiet or
  // --json mode we mute diagnostics entirely so stdout stays clean for the JSON payload; otherwise the
  // engine's diagnostics go to the progress stream (STDERR by default), never to stdout.
  const suppressLogs = options.quiet || options.json;
  const logger = suppressLogs ? noopLogger : createTextLogger(progress);

  const result = await runBufferedAsk({
    userMessage: options.memory,
    logger,
    onEvent: streamProgress ? (event, data) => renderProgress(progress, event, data) : undefined,
  });

  if (options.json) {
    out.write(`${JSON.stringify(
      {
        answer: result.answer,
        status: result.status,
        toolsRun: result.toolsRun,
        guarded: result.guarded,
        receipt: result.receipt,
        errored: result.errored,
        errorMessage: result.errorMessage,
      },
      null,
      2,
    )}\n`);
    return result.errored ? 1 : 0;
  }

  if (result.errored) {
    progress.write(`\nReconstruction failed: ${result.errorMessage ?? 'unknown error'}\n`);
    return 1;
  }

  renderHumanResult(out, result);
  return 0;
}
