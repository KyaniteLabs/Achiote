export const KNOWLEDGE_GAP_TYPES = [
  'missing_local_accessibility',
  'insufficient_disambiguators',
  'generic_mechanism_drift',
  'control_flow_violation',
  'optional_search_used',
  'provider_path_failure',
  'wrapper_quality_regression',
];

export function analyzeKnowledgeGaps(rows) {
  const gaps = new Map();
  for (const row of rows) {
    if (!row || row.kind || row.mode !== 'achiote') continue;
    const text = String(row.text ?? '');
    const prompt = String(row.prompt ?? '');
    const tools = Array.isArray(row.tools) ? row.tools.map(String) : [];
    const quality = Array.isArray(row.quality) ? row.quality.map(String) : [];

    const context = {
      model: String(row.model ?? 'unknown-model'),
      provider: String(row.provider ?? 'unknown-provider'),
      prompt,
      signature: classifyMechanismSignature(prompt, text),
      text,
      tools,
      quality,
      at: String(row.at ?? ''),
      roundId: String(row.roundId ?? ''),
    };

    if (quality.includes('forbidden_tool:search_web')) {
      addGap(gaps, 'control_flow_violation', 'Achiote used search_web when the prompt or harness marked search as forbidden; fix planning/control flow, not dish knowledge.', context);
    } else if (tools.includes('search_web')) {
      addGap(gaps, 'optional_search_used', 'Achiote used search_web on this path; audit whether search was necessary for the workflow contract.', context);
    }
    if (/\b(?:dominant aromatic or spice family|Ask what gave the liquid body|cheap neutral liquid carrier)\b/i.test(text)) {
      addGap(gaps, 'generic_mechanism_drift', 'Final cue stayed at a generic mechanism level; improve the generic cue contract or disambiguation flow before adding domain-specific coverage.', context);
    }
    if (/\b(?:where did you eat it|country|region|from|grandmother|neighbor|aunt|specific place)\b/i.test(text)
      && !/\b(?:minimum viable|first-pass verification)\b/i.test(text)) {
      addGap(gaps, 'insufficient_disambiguators', 'The answer needed a disambiguator but did not pair it with a useful minimum cue.', context);
    }
    if (quality.includes('missed_minimum_cue_frame') || quality.includes('empty_text')) {
      addGap(gaps, 'provider_path_failure', 'The provider path did not surface usable text; treat as provider/runtime evidence unless the wrapper also failed.', context);
    }
    if (quality.includes('full_recipe_drift') || quality.includes('overconfident_identity') || quality.includes('false_browsing_claim')) {
      addGap(gaps, 'wrapper_quality_regression', 'Achiote final text retained a quality failure that the wrapper should normally prevent; turn repeated cases into fake-provider regressions.', context);
    }
    if (/\b(?:buy|grocery|store|local sourcing|ordinary grocery)\b/i.test(text)
      && !/\b(?:pantry|already available|cheap|tiny)\b/i.test(text)) {
      addGap(gaps, 'missing_local_accessibility', 'Local sourcing guidance appeared without an accessibility-first pantry proxy.', context);
    }
  }

  return [...gaps.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function addGap(gaps, type, reason, context) {
  const key = `${type}\u0000${context.signature}`;
  const existing = gaps.get(key) ?? {
    type,
    signature: context.signature,
    count: 0,
    reason,
    examples: [],
  };
  existing.count += 1;
  if (existing.examples.length < 3) {
    existing.examples.push({
      provider: context.provider,
      model: context.model,
      roundId: context.roundId,
      at: context.at,
      prompt: context.prompt,
      tools: context.tools,
      quality: context.quality,
      excerpt: context.text.slice(0, 260),
    });
  }
  gaps.set(key, existing);
}

function classifyMechanismSignature(prompt, text) {
  const combined = `${prompt} ${text}`.toLowerCase();
  if (/\b(?:sour|tart|pickle|brine|ferment|dill|herb|zurek|żurek|sorrel|potato|egg)\b/.test(combined)
    && /\b(?:soup|broth|sip|liquid|body|chunks?|pieces?)\b/.test(combined)) {
    return 'sour_herb_soup';
  }
  if (/\b(?:rice|cinnamon|barley|cebada|horchata|grain|agua|drink|beverage|sip|ice|lime)\b/.test(combined)) {
    return 'grain_beverage';
  }
  if (/\b(?:carimanol|carimañol|caribañol|cassava|yuca|tapioca|fritter|plantain|panama|colombia)\b/.test(combined)) {
    return 'cassava_fritter';
  }
  if (/\b(?:substitution|nut-free|vegan|halal|gluten-free|heart-healthier|cream|tomato|curry|cashew|butter|naan)\b/.test(combined)) {
    return 'substitution_role_mapping';
  }
  if (/\b(?:coconut|sugar|crystal|grainy|festival|celebration|sweet|confection|candy)\b/.test(combined)) {
    return 'sugar_confectionery';
  }
  return 'general_memory_mechanism';
}
