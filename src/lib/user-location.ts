export function inferUserLocationFromMessage(userMessage: string): string | undefined {
  const match = userMessage.match(/\b(?:i\s+(?:live|am|currently\s+live|currently\s+am)|i['’]?m|im|we\s+(?:live|are)|based|located)\s+in\s+([^.!?;,]{2,80})/i)
    ?? userMessage.match(/\b(?:buy|find|get|source|shop\s+for)\b[^.!?;,]{0,80}\b(?:in|near|around)\s+([^.!?;,]{2,80})/i);
  if (!match?.[1]) return undefined;
  const location = match[1]
    .replace(/\s+(?:now|currently|these days|at the moment)\b.*$/i, '')
    .replace(/\s+(?:and|but|so|because|while|for|to)\b.*$/i, '')
    .trim();
  if (location.length < 2 || /^(?:the|a|an|this|that|it|there|me|my|my area|here|your area)\b/i.test(location)) return undefined;
  return location.slice(0, 80);
}
