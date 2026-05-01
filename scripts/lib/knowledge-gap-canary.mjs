export const KNOWLEDGE_GAP_TYPES = [
  'missing_dish_alias',
  'missing_regional_family',
  'weak_sensory_signature',
  'missing_substitution_role',
  'missing_local_accessibility',
  'overbroad_family',
  'insufficient_disambiguators',
  'search_dependency',
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
      cueClass: classifyCueClass(prompt, text),
      text,
      tools,
      quality,
      at: String(row.at ?? ''),
      roundId: String(row.roundId ?? ''),
    };

    if (tools.includes('search_web')) {
      addGap(gaps, 'search_dependency', 'Achiote used search_web; internal reference data should make this optional enrichment, not required control flow.', context);
    }
    if (/\b(?:dominant aromatic or spice family|Ask what gave the liquid body|cheap neutral liquid carrier)\b/i.test(text)) {
      addGap(gaps, 'overbroad_family', 'Final cue stayed at a generic mechanism/family level instead of naming a stronger internal reference target.', context);
    }
    if (/\b(?:where did you eat it|country|region|from|grandmother|neighbor|aunt|specific place)\b/i.test(text)
      && !/\b(?:minimum viable|first-pass verification)\b/i.test(text)) {
      addGap(gaps, 'insufficient_disambiguators', 'The answer needed a disambiguator but did not pair it with a useful minimum cue.', context);
    }
    if (/\b(?:carimanol|carimañol|caribana|panama)\b/i.test(prompt)
      && /\b(?:cassava-family carrier|plantain crisped|tapioca-starch paste)\b/i.test(text)) {
      addGap(gaps, 'missing_dish_alias', 'Known misspelling/transliteration was handled generically; add alias and sensory signature coverage for the family.', context);
    }
    if (/\b(?:sour dill|polish neighbor|zurek|żurek)\b/i.test(prompt)
      && /\b(?:dominant aromatic or spice family|Ask what gave the liquid body)\b/i.test(text)) {
      addGap(gaps, 'missing_regional_family', 'Sour-dill soup stayed generic; add regional sour soup family distinctions and acid/body disambiguators.', context);
    }
    if (/\b(?:substitution|nut-free|vegan|halal|gluten-free|heart-healthier)\b/i.test(prompt)
      && /\b(?:cheap grocery-store carrier|accessible protein|plant-based substitute)\b/i.test(text)) {
      addGap(gaps, 'missing_substitution_role', 'Substitution request fell back to generic carrier/protein language; add original sensory-role mapping before adapted cues.', context);
    }
    if (quality.includes('missed_minimum_cue_frame') || quality.includes('empty_text')) {
      addGap(gaps, 'weak_sensory_signature', 'Model path did not surface a usable cue; internal sensory signatures may be too weak for this mechanism class.', context);
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
  const key = `${type}\u0000${context.cueClass}`;
  const existing = gaps.get(key) ?? {
    type,
    cueClass: context.cueClass,
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

function classifyCueClass(prompt, text) {
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
