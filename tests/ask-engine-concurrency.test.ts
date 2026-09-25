/**
 * CONCURRENCY REGRESSION for the transport-neutral ask engine (src/core/ask-engine.ts).
 *
 * The engine used to hold ~8 module-scoped `let` singletons (providerRuntime, toolContext,
 * qualitySignalReport, cacheState, deterministicToolChain, finalSynthesis*, logger) that
 * runAskWorkflow reassigned at the top of every call. Because the HTTP server hosts the in-process MCP
 * server in the SAME process, a concurrent HTTP `/ask` and an in-process MCP `reconstruct_food_memory`
 * call clobbered each other's singletons across `await` suspension points: quality signals recorded into
 * the wrong report, diagnostics misrouted to the other call's logger.
 *
 * This test drives TWO runAskWorkflow calls CONCURRENTLY via Promise.all with deliberately DISTINCT
 * deps — different logger spies and different in-memory quality-signal-report instances — and forces the
 * runs to interleave across an `await` (selectedProviderSupportsNativeTools resolves on a delay). It then
 * asserts each call's logger saw only its own diagnostics and each quality report recorded exactly one
 * isolated signal. Against the old singleton code the runs cross-bleed and this FAILS; after the per-call
 * `ctx` refactor each run is isolated and it PASSES.
 *
 * The runs take the fully-deterministic recovery path (selectedProviderSupportsNativeTools === false), so
 * no model/network is touched and the orchestration is exercised entirely server-side.
 */
import { describe, expect, it } from 'vitest';
import { createAskEngineDeps } from '../src/core/ask-engine-deps.js';
import { runAskWorkflow, type AskEngineDeps } from '../src/core/ask-engine.js';
import type { ProviderRuntime } from '../src/lib/provider-runtime.js';
import type { Logger } from '../src/core/logger.js';
import { emptyQualitySignalReport, type QualitySignalReport } from '../src/lib/quality-signals.js';
import { LOCAL_ASK_CONSENT } from '../src/core/ask-run-buffer.js';

/** A logger that records every message it receives, so we can prove no cross-routing happened. */
function recordingLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];
  const sink = (message: string) => { messages.push(message); };
  return {
    messages,
    logger: {
      debug: (m) => sink(m),
      info: (m) => sink(m),
      warn: (m) => sink(m),
      error: (m) => sink(m),
    },
  };
}

/**
 * Build a self-contained deps bundle with a DISTINCT logger and quality-signal report, then force the
 * deterministic-recovery path by making selectedProviderSupportsNativeTools resolve `false` after a
 * delay so concurrent runs interleave across the await. The createAskSession stub is never reached on
 * this path.
 */
function makeIsolatedDeps(delayMs: number): {
  deps: AskEngineDeps;
  messages: string[];
  report: QualitySignalReport;
  closeCache: () => void;
} {
  const { logger, messages } = recordingLogger();
  const report = emptyQualitySignalReport();
  const bundle = createAskEngineDeps({ logger, qualitySignalReport: report });

  const realRuntime = bundle.providerRuntime;
  const fakeRuntime: ProviderRuntime = {
    ...realRuntime,
    selectedProviderSupportsNativeTools: () =>
      new Promise((resolve) => setTimeout(() => resolve(false), delayMs)),
    createAskSession: () => ({
      create: () => Promise.reject(new Error('model must not be called on the deterministic path')),
      appendToolResults: () => {},
      injectDeterministicToolResult: () => {},
      setAvailableTools: () => {},
      pushUserMessage: () => {},
      compactForSynthesis: () => {},
    }),
  };

  const deps: AskEngineDeps = { ...bundle.deps, providerRuntime: fakeRuntime };
  return { deps, messages, report, closeCache: () => bundle.cacheState.cache?.close() };
}

describe('ask engine concurrency isolation', () => {
  it('keeps loggers and quality-signal reports isolated across two concurrent runs', async () => {
    // Distinct delays guarantee the two runs interleave across the selectedProviderSupportsNativeTools
    // await: run A starts first, run B is reassigning state while A is mid-flight, and vice versa.
    const a = makeIsolatedDeps(40);
    const b = makeIsolatedDeps(10);

    const eventsA: Array<{ event: string; data: unknown }> = [];
    const eventsB: Array<{ event: string; data: unknown }> = [];

    try {
      await Promise.all([
        runAskWorkflow({
          input: {
            userMessage: 'My abuela in Oaxaca made mole negro with chilhuacle chiles and chocolate. Give me the smallest first taste test.',
            images: [],
            consent: LOCAL_ASK_CONSENT,
          },
          deps: a.deps,
          emit: (event, data) => eventsA.push({ event, data }),
        }),
        runAskWorkflow({
          input: {
            userMessage: 'My dad fried plantains until the edges caramelized in Puerto Rico. Give me the smallest first taste test.',
            images: [],
            consent: LOCAL_ASK_CONSENT,
          },
          deps: b.deps,
          emit: (event, data) => eventsB.push({ event, data }),
        }),
      ]);
    } finally {
      a.closeCache();
      b.closeCache();
    }

    // Each run completed cleanly with its own terminal done event and no error.
    expect(eventsA.some((e) => e.event === 'error')).toBe(false);
    expect(eventsB.some((e) => e.event === 'error')).toBe(false);
    expect(eventsA.at(-1)?.event).toBe('done');
    expect(eventsB.at(-1)?.event).toBe('done');

    // Both runs took the deterministic recovery path, so both emitted diagnostics. Under the old
    // singletons one logger would receive both runs' messages (or none); per-call ctx keeps them apart.
    expect(a.messages.length).toBeGreaterThan(0);
    expect(b.messages.length).toBeGreaterThan(0);

    // Quality-signal isolation: each report recorded exactly its own single completion. Under the old
    // singletons one report would tally 2 (both runs) and the other 0.
    expect(a.report.total).toBe(1);
    expect(b.report.total).toBe(1);

    // The reports captured DIFFERENT memory regions (Oaxaca vs Puerto Rico), proving each run's finish()
    // recorded into its OWN report rather than the other run's. Under the old singletons both finish()
    // calls would hit whichever report was assigned last, so one report would carry both regions (or the
    // wrong one) instead of exactly its own.
    expect(Object.keys(a.report.byRegion)).toEqual(['oaxacan']);
    expect(Object.keys(b.report.byRegion)).toEqual(['puerto_rican']);
  }, 20_000);
});
