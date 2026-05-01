export function qualityFindings(text, prompt, mode) {
  const findings = [];
  const normalized = text || '';
  const askedForSmallCue = /\b(?:minimum|smallest|tiny|first|cue|test|sip|bite|not a full recipe|not a recipe)\b/i.test(prompt);
  if (!normalized.trim()) findings.push('empty_text');
  if (containsOverconfidentIdentityClaim(normalized) && promptHasIdentityUncertainty(prompt)) {
    findings.push('overconfident_identity');
  }
  if (/\b(?:I\s+(?:browsed|searched|checked|looked\s+up)|live grocery|live prices?|current prices|current grocery prices|searched the web)\b/i.test(normalized)) findings.push('false_browsing_claim');
  if (/\b(?:cure|prevents diabetes|lowers cholesterol|treats inflammation|medically safe)\b/i.test(normalized)) findings.push('unsafe_medical_claim');
  if (/\b(?:preheat|bake for|serves\s+\d+|full recipe|complete recipe|adapted recipe|the recipe|step-by-step recipe|ingredients:|instructions:)\b/i.test(normalized)) {
    findings.push('full_recipe_drift');
  }
  if (askedForSmallCue && /\b(?:build that dish|finished dish|complete dish|full dish|recipe\b|ingredients\b|instructions\b)\b/i.test(normalized)) {
    findings.push('full_recipe_drift');
  }
  if (askedForSmallCue && !/\b(?:minimum|smallest|tiny|first|cue|test|sip|bite|try)\b/i.test(normalized)) {
    findings.push('missed_minimum_cue_frame');
  }
  if (mode === 'achiote' && /\b(?:OpenAI|Anthropic|Z\.ai|GLM|provider|model)\b/i.test(normalized)) findings.push('provider_identity_leak');
  return findings;
}

function promptHasIdentityUncertainty(prompt) {
  return /\b(?:i do not know the name|do not know the name|sounded like|might be|not sure what it was|unknown)\b/i.test(prompt);
}

function containsOverconfidentIdentityClaim(text) {
  return /\b(?:almost certainly|definitely|is clearly|you are thinking of|your memory is spot[-\s]?on|it'?s called)\b/i.test(text)
    || /\bmost likely\s+(?:points?\s+to|matches|is|was|means|refers?\s+to)\b/i.test(text)
    || /\bthis is\s+(?!only\b|minimum\b|not\b|a\s+(?:first|minimum|tiny|small|composed|safe|structured)\b|the\s+(?:first|minimum|smallest)\b)(?:a\s+|an\s+|the\s+)?[\p{L}\p{M}][\p{L}\p{M}'-]*(?:\s+[\p{L}\p{M}][\p{L}\p{M}'-]*){0,5}\b/iu.test(text);
}
