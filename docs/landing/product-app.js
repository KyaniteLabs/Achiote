(function attachProductApp(global) {
  function parseSseChunk(buffer, chunk) {
    const combined = `${buffer || ''}${chunk || ''}`;
    const lines = combined.split('\n');
    const pending = lines.pop() || '';
    const events = [];
    let eventType = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith('data: ')) {
        events.push({ type: eventType, data: line.slice(6) });
      }
    }
    return { pending, events };
  }

  function explainHttpStatus(status, detail) {
    const suffix = String(detail || '').trim();
    if (status === 401) return `The public demo should be open. Reload once, then contact support if this continues. ${suffix}`.trim();
    if (status === 429) return `Rate limit exceeded. ${suffix}`.trim();
    if (status === 413) return `Message is too large. ${suffix}`.trim();
    if (status === 415) return `Server expected JSON but received a different content type. ${suffix}`.trim();
    return `Server error ${status}. ${suffix || 'Could not parse server response'}`.trim();
  }

  function appendChatTurn(history, userMessage, assistantText, maxEntries) {
    const next = [
      ...(Array.isArray(history) ? history : []),
      { role: 'user', content: String(userMessage || '') },
      { role: 'assistant', content: String(assistantText || '') },
    ];
    const limit = Number.isFinite(maxEntries) && maxEntries > 0 ? maxEntries : 20;
    return next.length > limit ? next.slice(-limit) : next;
  }

  global.AchioteProductApp = {
    parseSseChunk,
    explainHttpStatus,
    appendChatTurn,
  };
})(typeof window === 'undefined' ? globalThis : window);
