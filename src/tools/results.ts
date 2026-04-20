export type ToolPayload = Record<string, unknown>;

export function sanitizeForPrompt(value: string): string {
  const stripped = value.replace(/<\/?\s*user_input\s*>/g, '');
  return JSON.stringify(stripped);
}

export function structuredJsonResult(payload: ToolPayload, displayText?: string) {
  return {
    content: [{ type: 'text' as const, text: displayText ?? JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export function toolError(error: unknown, code: string) {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/\/[^\s"']+/g, '[path]');
  const payload = { error: { code, message } };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}
