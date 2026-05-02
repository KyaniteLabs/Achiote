import { describe, expect, it, vi } from 'vitest';
import type { AskSession } from '../src/lib/ask-provider.js';
import { createAskTurnState, runDeterministicWorkflowPlan } from '../src/lib/ask-controller.js';
import type { AchioteToolExecutionContext } from '../src/tools/tool-registry.js';

function createMockAskSession(): AskSession {
  return {
    create: vi.fn(),
    appendToolResults: vi.fn(),
    injectDeterministicToolResult: vi.fn(),
    setAvailableTools: vi.fn(),
    pushUserMessage: vi.fn(),
    compactForSynthesis: vi.fn(),
  };
}

describe('AskController deterministic workflow planning', () => {
  it('injects the deterministic plan and exposes only next-step tools', async () => {
    const askSession = createMockAskSession();
    const state = createAskTurnState('warm sour rice drink from my aunt');
    const sent: Array<{ event: string; data: unknown }> = [];
    const planPayload = {
      detectedIntent: 'nostalgic_memory',
      maxSearchCalls: 0,
      workflowSteps: [{ tool: 'collect_food_memory' }],
    };
    const configureAvailableTools = vi.fn();

    await runDeterministicWorkflowPlan({
      askSession,
      state,
      toolContext: {} as AchioteToolExecutionContext,
      executeTool: vi.fn().mockResolvedValue({ payload: planPayload }),
      configureAvailableTools,
      send: (event, data) => sent.push({ event, data }),
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(state.calledTools.has('plan_tool_workflow')).toBe(true);
    expect(state.toolPayloads.plan_tool_workflow).toBe(planPayload);
    expect(state.didInjectPlanToolResult).toBe(true);
    expect(askSession.injectDeterministicToolResult).toHaveBeenCalledWith(
      'deterministic_plan_tool_workflow',
      'plan_tool_workflow',
      { userMessage: 'warm sour rice drink from my aunt' },
      planPayload,
    );
    expect(configureAvailableTools).toHaveBeenCalledWith(askSession, state.toolPayloads, state.calledTools);
    expect(sent).toEqual([
      { event: 'status', data: { stage: 'routing', tool: 'plan_tool_workflow' } },
      { event: 'tool_call', data: { name: 'plan_tool_workflow', input: state.deterministicPlanInput, deterministic: true } },
      { event: 'tool_result', data: { name: 'plan_tool_workflow', result: planPayload, deterministic: true } },
    ]);
  });

  it('falls back to default available tools when deterministic planning fails', async () => {
    const askSession = createMockAskSession();
    const state = createAskTurnState('something crunchy from a bakery');
    const configureAvailableTools = vi.fn();
    const warn = vi.fn();

    await runDeterministicWorkflowPlan({
      askSession,
      state,
      toolContext: {} as AchioteToolExecutionContext,
      executeTool: vi.fn().mockRejectedValue(new Error('planner unavailable')),
      configureAvailableTools,
      send: vi.fn(),
      logger: { log: vi.fn(), warn },
    });

    expect(state.calledTools.has('plan_tool_workflow')).toBe(false);
    expect(state.toolPayloads.plan_tool_workflow).toBeUndefined();
    expect(state.didInjectPlanToolResult).toBe(false);
    expect(askSession.injectDeterministicToolResult).not.toHaveBeenCalled();
    expect(configureAvailableTools).toHaveBeenCalledWith(askSession, state.toolPayloads, state.calledTools);
    expect(warn).toHaveBeenCalledWith('[ask] plan_tool_workflow failed, using defaults:', 'planner unavailable');
  });
});
