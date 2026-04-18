export type ToolPayload = Record<string, unknown>;

export function structuredJsonResult(payload: ToolPayload) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export function toolError(error: unknown, code: string) {
  const message = error instanceof Error ? error.message : String(error);
  const payload = { error: { code, message } };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}
