/**
 * MCP `reconstruct_food_memory` tool — the full /ask workflow as a single MCP tool call.
 *
 * The 18 registry tools expose the workflow's granular steps. This tool runs the ENTIRE orchestration
 * (the same `runAskWorkflow` the HTTP `/ask` route and the CLI drive) in one call, buffering the engine
 * events and returning MCP structured output: the synthesized prose, the Memory Receipt, and key
 * milestones. It is registered ALONGSIDE the 18 granular tools, not in place of them.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { memoryReceiptOutputSchema } from '../schemas/tool-schemas.js';
import { runBufferedAsk } from './ask-run-buffer.js';
import { noopLogger } from './logger.js';

export const RECONSTRUCT_TOOL_NAME = 'reconstruct_food_memory';

export const reconstructInputSchema = {
  memory: z.string().min(1).max(6000).describe('The raw food or drink memory to reconstruct: place, people, smell, texture, packaging, cooking method, occasion, or any sensory fragment.'),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(20)
    .optional()
    .describe('Optional prior turns of the conversation, oldest first, for follow-up clarification.'),
  userLocation: z
    .string()
    .min(1)
    .max(300)
    .optional()
    .describe('Optional current location used for sourcing and locally-available substitutes.'),
} as const;

export const reconstructOutputSchema = {
  answer: z.string().describe('The synthesized, warm, food-science-grounded reconstruction prose for the user.'),
  status: z
    .enum(['needs_more_clues', 'first_test_ready', 'recipe_handoff_ready'])
    .optional()
    .describe('Memory Receipt status: whether more clues are needed, a first taste test is ready, or it is ready for recipe handoff.'),
  toolsRun: z.array(z.string()).describe('The workflow tools that actually executed, in order, e.g. collect_food_memory, plan_dish_research, generate_minimum_viable_nostalgia.'),
  guarded: z.string().optional().describe('Set when a deterministic guard path produced the answer (e.g. minimum_cue_deterministic_completion).'),
  receipt: memoryReceiptOutputSchema.optional().describe('The full Achiote Memory Receipt: evidence ledger, hypotheses, next questions, and the first tiny taste test.'),
} as const;

const reconstructAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

type ReconstructInput = {
  memory: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  userLocation?: string;
};

/** Register the single-call reconstruction tool on an MCP server, alongside the granular registry tools. */
export function registerReconstructTool(server: McpServer): void {
  server.registerTool(
    RECONSTRUCT_TOOL_NAME,
    {
      title: 'Reconstruct Food Memory',
      description:
        'Run the full Achiote food-memory reconstruction workflow in one call: collect the memory, research and resolve the dish, build the evidence dossier, and return a minimum viable nostalgia cue with a Memory Receipt. Returns structured output with the synthesized reconstruction prose, status, tools run, and a Memory Receipt. Use when the user wants a complete reconstruction in a single call; use the granular tools only when driving individual steps. Pass memory from the user raw food or drink memory, optionally history for context and userLocation for sourcing.',
      inputSchema: reconstructInputSchema,
      outputSchema: reconstructOutputSchema,
      annotations: reconstructAnnotations,
    },
    async (rawInput: ReconstructInput) => {
      const userMessage = rawInput.userLocation
        ? `${rawInput.memory}\n\n(I currently live in ${rawInput.userLocation}.)`
        : rawInput.memory;

      const result = await runBufferedAsk({
        userMessage,
        history: rawInput.history,
        // MCP stdio owns stdout/stderr framing: any stray diagnostic write corrupts the transport, so
        // the engine logs to nowhere here.
        logger: noopLogger,
      });

      if (result.errored) {
        const payload = { error: { code: 'reconstruction_failed', message: result.errorMessage ?? 'Reconstruction failed' } };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
          isError: true,
        };
      }

      const structured = {
        answer: result.answer,
        status: result.status,
        toolsRun: result.toolsRun,
        guarded: result.guarded,
        receipt: result.receipt,
      };

      return {
        content: [{ type: 'text' as const, text: result.answer || JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  );
}
