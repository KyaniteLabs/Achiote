export type ToolCallRecord = {
  name: string;
  input: unknown;
};

export type ToolLoopReason = 'duplicate_input' | 'max_calls';

export type ToolLoopDecision<T extends ToolCallRecord> = {
  allowedCalls: T[];
  blockedCalls: Array<{ call: T; previousCount: number; reason: ToolLoopReason }>;
};

export function canonicalToolInput(value: unknown): string {
  return JSON.stringify(sortJsonValue(value)) ?? '"__undefined__"';
}

export function filterRepeatedToolCalls<T extends ToolCallRecord>(
  calls: T[],
  history: ToolCallRecord[],
  maxCallsPerTool = 5,
): ToolLoopDecision<T> {
  const allowedCalls: T[] = [];
  const blockedCalls: Array<{ call: T; previousCount: number; reason: ToolLoopReason }> = [];

  for (const call of calls) {
    const previousCalls = [...history, ...allowedCalls].filter((h) => h.name === call.name);
    const inputKey = canonicalToolInput(call.input);
    const hasSameInput = previousCalls.some((h) => canonicalToolInput(h.input) === inputKey);
    if (hasSameInput) {
      blockedCalls.push({ call, previousCount: previousCalls.length, reason: 'duplicate_input' });
      continue;
    }
    if (previousCalls.length >= maxCallsPerTool) {
      blockedCalls.push({ call, previousCount: previousCalls.length, reason: 'max_calls' });
      continue;
    }
    allowedCalls.push(call);
  }

  return { allowedCalls, blockedCalls };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, sortJsonValue(nested)]),
  );
}
