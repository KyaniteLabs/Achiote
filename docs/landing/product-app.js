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

  // Condense a Memory Receipt into a compact text summary so a receipt-only turn
  // (no prose) still leaves a non-empty assistant entry in history. Without this,
  // the caller skips appendChatTurn entirely and the user's own message for that
  // turn is dropped, which resets the conversation and loses earlier clues.
  function summarizeReceiptForHistory(receipt) {
    if (!receipt || typeof receipt !== 'object') return '';
    const evidence = receipt.evidence && typeof receipt.evidence === 'object' ? receipt.evidence : {};
    const parts = [];
    const pushList = (label, value) => {
      const items = Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()) : [];
      if (items.length) parts.push(`${label}: ${items.join('; ')}`);
    };
    pushList('Known', evidence.userSaid);
    pushList('Researched', evidence.researched);
    pushList('Inferred', evidence.inferred);
    pushList('Still unknown', evidence.unknown);
    const taste = receipt.firstTinyTasteTest && typeof receipt.firstTinyTasteTest === 'object'
      ? receipt.firstTinyTasteTest
      : null;
    const cue = taste && (taste.cue || taste.title);
    if (cue) parts.push(`First taste: ${cue}`);
    if (!parts.length) return '';
    const summary = `Memory Receipt so far —\n${parts.join('\n')}`;
    return summary.length > 2000 ? `${summary.slice(0, 2000)}…` : summary;
  }

  global.AchioteProductApp = {
    parseSseChunk,
    explainHttpStatus,
    appendChatTurn,
    summarizeReceiptForHistory,
  };
})(typeof window === 'undefined' ? globalThis : window);
