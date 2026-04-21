export type ToolPayload = Record<string, unknown>;

export function sanitizeForPrompt(value: string): string {
  return value
    .replace(/<\/?\s*user_input\s*>/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

export function structuredJsonResult(payload: ToolPayload, displayText?: string) {
  return {
    content: [{ type: 'text' as const, text: displayText ?? JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export function toolError(error: unknown, code: string) {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/(?:\/(?:usr|home|var|tmp|etc|src|opt|Users)[^\s"']*)/g, '[path]');
  const payload = { error: { code, message } };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}
