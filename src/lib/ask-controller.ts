import type { AskSession } from './ask-provider.js';
import type { AchioteToolExecutionContext } from '../tools/tool-registry.js';

export type AskSseSender = (event: string, data: unknown) => void;

export type AskTurnState = {
  calledTools: Set<string>;
  toolPayloads: Record<string, unknown>;
  deterministicPlanInput: { userMessage: string };
  didInjectPlanToolResult: boolean;
};

export type AskToolExecutor = (
  toolName: string,
  input: unknown,
  context: AchioteToolExecutionContext,
) => Promise<{ payload: unknown }>;

export type AskToolAvailabilityConfigurer = (
  askSession: AskSession,
  toolPayloads: Record<string, unknown>,
  calledTools: Set<string>,
) => void;

type Logger = Pick<Console, 'log' | 'warn'>;

export type DeterministicWorkflowPlanInput = {
  askSession: AskSession;
  state: AskTurnState;
  toolContext: AchioteToolExecutionContext;
  executeTool: AskToolExecutor;
  configureAvailableTools: AskToolAvailabilityConfigurer;
  send: AskSseSender;
  logger?: Logger;
};

export function createAskTurnState(userMessage: string): AskTurnState {
  return {
    calledTools: new Set<string>(),
    toolPayloads: {},
    deterministicPlanInput: { userMessage },
    didInjectPlanToolResult: false,
  };
}

export async function runDeterministicWorkflowPlan(input: DeterministicWorkflowPlanInput): Promise<void> {
  const logger = input.logger ?? console;
  const { askSession, state, toolContext, executeTool, configureAvailableTools, send } = input;

  send('status', { stage: 'routing', tool: 'plan_tool_workflow' });
  try {
    const planResult = await executeTool('plan_tool_workflow', state.deterministicPlanInput, toolContext);
    state.calledTools.add('plan_tool_workflow');
    state.toolPayloads.plan_tool_workflow = planResult.payload;
    askSession.injectDeterministicToolResult(
      'deterministic_plan_tool_workflow',
      'plan_tool_workflow',
      state.deterministicPlanInput,
      planResult.payload,
    );
    state.didInjectPlanToolResult = true;
    configureAvailableTools(askSession, state.toolPayloads, state.calledTools);
    send('tool_call', { name: 'plan_tool_workflow', input: state.deterministicPlanInput, deterministic: true });
    send('tool_result', { name: 'plan_tool_workflow', result: planResult.payload, deterministic: true });
    logger.log(`[ask] plan_tool_workflow: intent=${(planResult.payload as Record<string, unknown>)?.detectedIntent} maxSearch=${(planResult.payload as Record<string, unknown>)?.maxSearchCalls}`);
  } catch (err) {
    logger.warn('[ask] plan_tool_workflow failed, using defaults:', err instanceof Error ? err.message : String(err));
    configureAvailableTools(askSession, state.toolPayloads, state.calledTools);
  }
}
