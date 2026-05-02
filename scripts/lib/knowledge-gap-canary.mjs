export const KNOWLEDGE_GAP_TYPES = [
  'missing_local_accessibility',
  'insufficient_disambiguators',
  'mechanism_signature_gap',
  'search_dependency_gap',
];

export const EXCLUDED_EVIDENCE_REASONS = [
  'control_flow_violation',
  'provider_path_failure',
  'wrapper_quality_regression',
];

export function analyzeKnowledgeGaps(rows) {
  const gaps = new Map();
  const excludedEvidence = [];
  const regressionCandidates = [];
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
      const excluded = excludedRow('control_flow_violation', 'Achiote used search_web when the prompt or harness marked search as forbidden; do not infer taxonomy gaps from this row.', context);
      excludedEvidence.push(excluded);
      regressionCandidates.push(regressionCandidate('control_flow_regression', 'Add a fake-provider regression that proves no-browse prompts cannot plan or execute search_web.', excluded));
      continue;
    }
    if (quality.includes('missed_minimum_cue_frame') || quality.includes('empty_text')) {
      excludedEvidence.push(excludedRow('provider_path_failure', 'The provider path did not surface usable text; do not infer taxonomy gaps from this row.', context));
      continue;
    }
    if (quality.includes('full_recipe_drift') || quality.includes('overconfident_identity') || quality.includes('false_browsing_claim')) {
      const excluded = excludedRow('wrapper_quality_regression', 'Achiote final text retained a quality failure that should become a fake-provider regression before taxonomy work.', context);
      excludedEvidence.push(excluded);
      regressionCandidates.push(regressionCandidate('wrapper_quality_regression', 'Add a fake-provider regression that reproduces the retained quality failure before taxonomy work.', excluded));
      continue;
    }

    if (tools.includes('search_web')) {
      addGap(gaps, 'search_dependency_gap', 'Achiote used search_web on a clean path; identify the missing taxonomy/reference signal that would let the workflow proceed without live search.', context);
    }
    if (/\b(?:dominant aromatic or spice family|Ask what gave the liquid body|cheap neutral liquid carrier)\b/i.test(text)) {
      addGap(gaps, 'mechanism_signature_gap', 'Final cue stayed at a generic mechanism level; add or refine reusable taxonomy axes for aroma, body, acid, fat, starch, texture, or disambiguation.', context);
    }
    if (/\b(?:where did you eat it|country|region|from|grandmother|neighbor|aunt|specific place)\b/i.test(text)
      && !/\b(?:minimum viable|first-pass verification|tiny\s+(?:amount|sip|bite|cue|test)|first\s+(?:cue|test)|do not buy the exact suspected dish)\b/i.test(text)) {
      addGap(gaps, 'insufficient_disambiguators', 'The answer needed a disambiguator but did not pair it with a useful minimum cue.', context);
    }
    if (/\b(?:buy|grocery|store|local sourcing|ordinary grocery)\b/i.test(text)
      && !/\b(?:pantry|already available|cheap|tiny)\b/i.test(text)) {
      addGap(gaps, 'missing_local_accessibility', 'Local sourcing guidance appeared without an accessibility-first pantry proxy.', context);
    }
  }

  return {
    knowledgeGaps: [...gaps.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    excludedEvidence,
    regressionCandidates,
  };
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

function excludedRow(reason, detail, context) {
  return {
    reason,
    detail,
    signature: context.signature,
    provider: context.provider,
    model: context.model,
    roundId: context.roundId,
    at: context.at,
    prompt: context.prompt,
    tools: context.tools,
    quality: context.quality,
    excerpt: context.text.slice(0, 260),
  };
}

function regressionCandidate(type, nextAction, excluded) {
  return {
    type,
    reason: excluded.reason,
    nextAction,
    signature: excluded.signature,
    provider: excluded.provider,
    model: excluded.model,
    roundId: excluded.roundId,
    at: excluded.at,
    prompt: excluded.prompt,
    tools: excluded.tools,
    quality: excluded.quality,
    excerpt: excluded.excerpt,
  };
}

function classifyMechanismSignature(prompt, text) {
  const combined = `${prompt} ${text}`.toLowerCase();
  if (/\b(?:coconut|sugar|crystal|grainy|festival|celebration|sweet|confection|candy)\b/.test(combined)) {
    return 'sugar_confectionery';
  }
  if (/\b(?:sour|tart|pickle|brine|ferment|dill|herb|zurek|żurek|sorrel|potato|egg)\b/.test(combined)
    && /\b(?:soup|broth|sip|liquid|body|chunks?|pieces?)\b/.test(combined)) {
    return 'sour_herb_soup';
  }
  if (/\b(?:rice|cinnamon|barley|cebada|horchata|grain|agua|drink|beverage|ice|lime)\b/.test(combined)) {
    return 'grain_beverage';
  }
  if (/\b(?:carimanol|carimañol|caribañol|cassava|yuca|tapioca|fritter|plantain|panama|colombia)\b/.test(combined)) {
    return 'cassava_fritter';
  }
  if (/\b(?:substitution|nut-free|vegan|halal|gluten-free|heart-healthier|cream|tomato|curry|cashew|butter|naan)\b/.test(combined)) {
    return 'substitution_role_mapping';
  }
  return 'general_memory_mechanism';
}
