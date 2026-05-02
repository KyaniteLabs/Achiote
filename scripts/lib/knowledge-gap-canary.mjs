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

export function buildTaxonomyRemediationQueue(analysis, options = {}) {
  const knowledgeGaps = Array.isArray(analysis?.knowledgeGaps) ? analysis.knowledgeGaps : [];
  const excludedEvidence = Array.isArray(analysis?.excludedEvidence) ? analysis.excludedEvidence : [];
  const regressionCandidates = Array.isArray(analysis?.regressionCandidates) ? analysis.regressionCandidates : [];
  const items = knowledgeGaps.map((gap) => taxonomyRemediationItem(gap));

  return {
    source: 'knowledge-gap-canary',
    sourceArtifact: String(options.sourceArtifact ?? ''),
    generatedAt: String(options.generatedAt ?? new Date().toISOString()),
    landedIn: String(options.landedIn ?? ''),
    summary: items.length === 0
      ? 'No clean taxonomy gaps were found in this canary artifact.'
      : `${items.length} clean taxonomy remediation item${items.length === 1 ? '' : 's'} ready for review.`,
    blockedByRegressionCandidates: regressionCandidates.length > 0,
    knowledgeGapCount: knowledgeGaps.length,
    excludedEvidenceCount: excludedEvidence.length,
    regressionCandidateCount: regressionCandidates.length,
    items,
  };
}

export function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function taxonomyRemediationItem(gap) {
  const type = String(gap?.type ?? 'unknown_gap');
  const signature = String(gap?.signature ?? 'general_memory_mechanism');
  const count = Number.isFinite(gap?.count) ? gap.count : 0;
  return {
    id: `${slug(type)}-${slug(signature)}`,
    status: 'ready_for_taxonomy',
    gapType: type,
    mechanismSignature: signature,
    count,
    reason: String(gap?.reason ?? ''),
    priority: count >= 3 ? 'high' : 'medium',
    candidateSeedIds: candidateSeedIds(signature),
    taxonomyTargets: taxonomyTargets(type, signature),
    acceptanceCriteria: acceptanceCriteria(type, signature),
    guardrails: [
      'Do not copy canary prompt text into production taxonomy; use generalized mechanisms, aliases, and sourced reference records.',
      'Do not convert provider, wrapper, or control-flow failures into taxonomy tasks.',
      'Keep search optional: exact/source-backed research paths may still search, but minimum-cue paths should not require it.',
      'Add or update regression coverage before closing the remediation item.',
    ],
    examples: cleanExamples(gap?.examples),
  };
}

function candidateSeedIds(signature) {
  const map = {
    sour_herb_soup: ['soup-sour-herb-eastern-europe'],
    grain_beverage: ['beverage-rice-cinnamon-latin-america', 'beverage-barley-cebada-latin-america'],
    cassava_fritter: ['cassava-fritter-caribbean-central-america'],
    sugar_confectionery: ['confectionery-coconut-sugar-festival'],
    substitution_role_mapping: ['curry-cream-tomato-substitution-roles'],
  };
  return map[signature] ?? [];
}

function taxonomyTargets(type, signature) {
  const targetsBySignature = {
    sour_herb_soup: [
      'Differentiate acid source, herb aroma, starch/body, egg/dairy cues, and warm-vs-cold serving temperature.',
      'Map pantry-first proxy cues for sour liquid, dill/herb aroma, potato body, and optional egg richness.',
    ],
    grain_beverage: [
      'Differentiate rice, barley, oat, sesame/nut, cinnamon, lime, toasted grain, and starch-body cues.',
      'Map cold beverage memory cues to cheap pantry tests before exact drink identity or sourcing.',
    ],
    cassava_fritter: [
      'Connect cassava/yuca/tapioca starch, fried browning, stuffed center, and phonetic alias cues.',
    ],
    sugar_confectionery: [
      'Differentiate crystallized sugar, coconut/seed aroma, crumbly-vs-chewy texture, and festival serving cues.',
    ],
    substitution_role_mapping: [
      'Map substitute ingredients to sensory jobs such as fat, acid, browning, starch body, aroma, and protein/umami.',
    ],
  };
  const targetsByType = {
    search_dependency_gap: [
      'Identify bundled taxonomy or reference-seed coverage that should let clean minimum-cue paths proceed without live search.',
    ],
    mechanism_signature_gap: [
      'Replace generic mechanism wording with reusable aroma, body, acid, fat, starch, texture, or disambiguation axes.',
    ],
    insufficient_disambiguators: [
      'Pair the next narrowing question with a useful minimum cue instead of returning a question-only answer.',
    ],
    missing_local_accessibility: [
      'Prefer cheap pantry or grocery-store proxy cues before exact specialty sourcing.',
    ],
  };
  return [
    ...(targetsByType[type] ?? []),
    ...(targetsBySignature[signature] ?? ['Add generalized taxonomy coverage for the mechanism signature.']),
  ];
}

function acceptanceCriteria(type, signature) {
  const common = [
    `A clean canary for ${signature} avoids search_web unless the user asks for exact source-backed identity or research.`,
    'The cue remains a cheap, tiny, food-science-grounded verification step rather than a recipe or shopping mission.',
    'The implementation keeps userSaid, researched facts, inferred facts, and unknowns separate.',
  ];
  if (type === 'mechanism_signature_gap') {
    return [
      `A clean canary for ${signature} uses specific reusable sensory mechanisms instead of generic placeholder language.`,
      ...common.slice(1),
    ];
  }
  if (type === 'insufficient_disambiguators') {
    return [
      `A clean canary for ${signature} asks one useful disambiguator only after offering a minimum viable cue.`,
      ...common.slice(1),
    ];
  }
  if (type === 'missing_local_accessibility') {
    return [
      `A clean canary for ${signature} starts with a pantry-first proxy before sourcing advice.`,
      ...common.slice(1),
    ];
  }
  return common;
}

function cleanExamples(examples) {
  if (!Array.isArray(examples)) return [];
  return examples.slice(0, 3).map((example) => ({
    provider: String(example.provider ?? ''),
    model: String(example.model ?? ''),
    roundId: String(example.roundId ?? ''),
    at: String(example.at ?? ''),
    promptRef: safePromptRef(example.prompt),
    usedSearchWeb: Array.isArray(example.tools) && example.tools.map(String).includes('search_web'),
    excerpt: String(example.excerpt ?? '').slice(0, 220),
  }));
}

function safePromptRef(prompt) {
  const value = String(prompt ?? '');
  if (/^[a-z0-9][a-z0-9_-]{1,80}$/i.test(value)) return value;
  return 'redacted-canary-prompt';
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  if (/\b(?:sour|tart|pickle|brine|ferment|dill|herb|zurek|żurek|sorrel|potato|egg)\b/.test(combined)
    && /\b(?:soup|broth|sip|liquid|body|chunks?|pieces?)\b/.test(combined)) {
    return 'sour_herb_soup';
  }
  if (/\b(?:rice|cinnamon|barley|cebada|horchata|grain|agua|drink|beverage|ice|lime)\b/.test(combined)) {
    return 'grain_beverage';
  }
  if (/\b(?:coconut|sugar|crystal|grainy|festival|celebration|sweet|confection|candy)\b/.test(combined)) {
    return 'sugar_confectionery';
  }
  if (/\b(?:carimanol|carimañol|caribañol|cassava|yuca|tapioca|fritter|plantain|panama|colombia)\b/.test(combined)) {
    return 'cassava_fritter';
  }
  if (/\b(?:substitution|nut-free|vegan|halal|gluten-free|heart-healthier|cream|tomato|curry|cashew|butter|naan)\b/.test(combined)) {
    return 'substitution_role_mapping';
  }
  return 'general_memory_mechanism';
}
