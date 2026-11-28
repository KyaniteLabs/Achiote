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

  // 2026-11-07 audit, ledger row 1: /app showed internal ids where product copy belongs. The
  // progress trace read "Calling build_reconstruction_dossier" and the Memory Receipt showed
  // its raw status token (first_test_ready, which the receipt style uppercases to
  // FIRST_TEST_READY). The helpers below turn ids into readable copy for display only. The
  // ids stay intact in the SSE stream and in the receipt JSON: those are the contract.
  const TOOL_LABELS = {
    plan_tool_workflow: 'Planning the next steps',
    collect_food_memory: 'Reading your memory',
    resolve_dish_name: 'Correcting the likely name',
    plan_dish_research: 'Planning the research',
    build_research_record: 'Researching sources',
    validate_research_record: 'Checking the research',
    extract_research_findings: 'Researching sources',
    build_reconstruction_dossier: 'Separating evidence from inference',
    generate_minimum_viable_nostalgia: 'Building your first taste',
    find_sensory_substitutes: 'Finding closer sensory substitutes',
    source_ingredients: 'Checking where to find ingredients',
    discover_regional_similars: 'Looking for related dishes',
    analyze_nostalgic_dish: 'Weighing the evidence',
    generate_family_followup_questions: 'Writing questions for your family',
    generate_recipe: 'Drafting the recipe',
    validate_recipe_output: 'Checking the recipe',
    build_memory_receipt: 'Writing your Memory Receipt',
    search_web: 'Researching sources',
    reconstruct_food_memory: 'Reconstructing the memory',
  };

  const RECEIPT_STATUS_LABELS = {
    first_test_ready: 'Ready for a first tiny taste test',
    needs_more_clues: 'Needs a few more clues',
    recipe_handoff_ready: 'Ready for the full recipe',
  };

  function ownLabel(table, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : '';
  }

  // Readable label for a tool id. Unknown or provider-invented ids return '' so the caller
  // falls back to generic copy; a raw id is never rendered.
  function toolLabel(name) {
    return ownLabel(TOOL_LABELS, name);
  }

  // Progress-trace line for a tool_call / tool_result event.
  function toolTraceLine(eventType, name) {
    const label = toolLabel(name);
    if (eventType === 'tool_result') return label ? `${label} · done` : 'Step finished';
    return label || 'Working';
  }

  // Readable label for a Memory Receipt status token. Unknown values return ''.
  function receiptStatusLabel(status) {
    return ownLabel(RECEIPT_STATUS_LABELS, status);
  }

  global.AchioteProductApp = {
    parseSseChunk,
    explainHttpStatus,
    appendChatTurn,
    summarizeReceiptForHistory,
    toolLabel,
    toolTraceLine,
    receiptStatusLabel,
  };
})(typeof window === 'undefined' ? globalThis : window);
