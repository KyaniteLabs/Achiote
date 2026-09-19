/**
 * Buffering runner for the transport-neutral ask engine.
 *
 * The MCP `reconstruct_food_memory` tool and the CLI `--json` mode both need to drive `runAskWorkflow`
 * to completion and then return a single structured result rather than a live event stream. This module
 * is the ONE place that buffers the engine's `(event, data)` pairs and distills them into a structured
 * summary (final prose, Memory Receipt, milestones). It does NOT reimplement any orchestration — it only
 * collects what the engine emits.
 */
import type { MemoryReceipt } from '../lib/types.js';
import { createAskEngineDeps, type CreateAskEngineDepsOverrides } from './ask-engine-deps.js';
import { runAskWorkflow, type RunAskWorkflowInput } from './ask-engine.js';
import type { Logger } from './logger.js';

export type BufferedAskEvent = { event: string; data: unknown };

export type ToolMilestone = { name: string };

export type StructuredAskResult = {
  /** Final synthesized prose surfaced via `text` events (joined when the engine emits more than one). */
  answer: string;
  /** The Memory Receipt emitted via the `receipt` event, when one was produced. */
  receipt?: MemoryReceipt;
  /** Tools that actually executed (deduped, in first-call order). */
  toolsRun: string[];
  /** Receipt status when present (needs_more_clues | first_test_ready | recipe_handoff_ready). */
  status?: MemoryReceipt['status'];
  /** Guard marker from the terminal `done` event, when the engine took a deterministic guard path. */
  guarded?: string;
  /** True when the engine emitted an `error` event instead of finishing cleanly. */
  errored: boolean;
  /** The error message when `errored` is true. */
  errorMessage?: string;
  /** Every buffered event, in order, for callers that need the full trace. */
  events: BufferedAskEvent[];
};

export type DefaultConsent = RunAskWorkflowInput['consent'];

/** Consent profile for non-HTTP callers (CLI/MCP host): allow quality signals so the receipt records cleanly. */
export const LOCAL_ASK_CONSENT: DefaultConsent = {
  analytics: false,
  qualitySignals: true,
  savedMemory: false,
  familyConfirmation: false,
  publicContribution: false,
};

export type RunBufferedAskInput = {
  userMessage: string;
  history?: RunAskWorkflowInput['history'];
  images?: RunAskWorkflowInput['images'];
  consent?: DefaultConsent;
  /** Optional live observer (e.g. the CLI TTY renderer) invoked for every event as it is emitted. */
  onEvent?: (event: string, data: unknown) => void;
  /**
   * Diagnostics sink for the engine. Convenience over `depsOverrides.logger`: the CLI passes a stderr
   * logger, the MCP host a no-op logger. When omitted the engine's JSON-stderr default is used.
   */
  logger?: Logger;
  /** Deps overrides; defaults to a fresh, self-contained createAskEngineDeps() bundle. */
  depsOverrides?: CreateAskEngineDepsOverrides;
};

function distill(events: BufferedAskEvent[]): Omit<StructuredAskResult, 'events'> {
  const textBlocks: string[] = [];
  const toolsRun: string[] = [];
  let receipt: MemoryReceipt | undefined;
  let guarded: string | undefined;
  let errored = false;
  let errorMessage: string | undefined;

  for (const { event, data } of events) {
    if (event === 'text' && typeof data === 'string') {
      textBlocks.push(data);
    } else if (event === 'tool_result' && data && typeof data === 'object') {
      const name = (data as { name?: unknown; blocked?: unknown }).name;
      const blocked = (data as { blocked?: unknown }).blocked === true;
      if (typeof name === 'string' && !blocked && !toolsRun.includes(name)) toolsRun.push(name);
    } else if (event === 'receipt') {
      receipt = data as MemoryReceipt;
    } else if (event === 'done' && data && typeof data === 'object') {
      const g = (data as { guarded?: unknown }).guarded;
      if (typeof g === 'string') guarded = g;
    } else if (event === 'error') {
      errored = true;
      const message = (data as { message?: unknown })?.message;
      errorMessage = typeof message === 'string' ? message : 'Unknown engine error';
    }
  }

  return {
    answer: textBlocks.join('\n\n'),
    receipt,
    toolsRun,
    status: receipt?.status,
    guarded,
    errored,
    errorMessage,
  };
}

/**
 * Run the full ask workflow with a buffering sink and return a structured result. Surfaces (MCP tool,
 * CLI) call this instead of touching the engine directly so the buffering and distillation stay in one
 * place.
 */
export async function runBufferedAsk(input: RunBufferedAskInput): Promise<StructuredAskResult> {
  const events: BufferedAskEvent[] = [];
  // A top-level `logger` is sugar for depsOverrides.logger; an explicit depsOverrides.logger wins.
  const depsOverrides: CreateAskEngineDepsOverrides | undefined = input.logger || input.depsOverrides
    ? { ...input.depsOverrides, logger: input.depsOverrides?.logger ?? input.logger }
    : undefined;
  const bundle = createAskEngineDeps(depsOverrides);

  try {
    await runAskWorkflow({
      input: {
        userMessage: input.userMessage,
        history: input.history,
        images: input.images ?? [],
        consent: input.consent ?? LOCAL_ASK_CONSENT,
      },
      deps: bundle.deps,
      emit: (event, data) => {
        events.push({ event, data });
        input.onEvent?.(event, data);
      },
    });
  } finally {
    // Close the cache this run created so the CLI process can exit cleanly. When the caller supplied a
    // shared toolContext/cacheState (e.g. a long-lived server), leave it open — they own its lifecycle.
    if (!input.depsOverrides?.toolContext && !input.depsOverrides?.cacheState) {
      bundle.cacheState.cache?.close();
    }
  }

  return { ...distill(events), events };
}
