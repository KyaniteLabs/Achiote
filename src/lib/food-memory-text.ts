export function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => {
    const escaped = escapeRegExp(needle).replace(/\s+/g, '\\s+');
    return new RegExp(`(?:^|\\b)${escaped}(?:$|\\b)`, 'i').test(text);
  });
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeForLooseMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matchesWordOrPhrase(text: string, hint: string): boolean {
  const pattern = escapeRegExp(hint).replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\b)${pattern}(?:$|\\b)`, 'i').test(text);
}
