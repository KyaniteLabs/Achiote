import { describe, expect, it } from 'vitest';
import { retrieveMechanisms } from '../src/lib/mechanism-retrieval.js';
import {
  buildReconstructionDossier,
  collectFoodMemory,
  generateMinimumViableNostalgiaCue,
  planDishResearch,
} from '../src/lib/memory-workflow.js';
import {
  appendGroundedCitation,
  buildEvidenceBoundedMinimumCueResponse,
  buildUserMessageMechanismCueResponse,
} from '../src/lib/ask-response-builder.js';

// A clearly-grounded iced-whisky memory: lay vocabulary ("whisky", "boozy",
// "alcohol", "ice") that the curated DB describes as ethanol/dilution science.
function icedWhiskyDossier() {
  const memory = collectFoodMemory({
    memoryText:
      'I miss the harsh hot whisky my abuelo drank over a big ice cube, boozy and full of alcohol burn.',
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'Adding water or ice to a whisky changes which aroma volatiles reach the nose; dilution opens up the spirit.',
    ],
    inferredFacts: [
      'The memory is driven by ethanol burn and the dilution/temperature state of an iced whisky pour.',
    ],
  });
}

describe('mechanism retrieval — engine grounding over the cited food-science DB', () => {
  it('retrieves a real-DOI dilution/ethanol mechanism for a boozy iced-whisky memory', () => {
    const matches = retrieveMechanisms('harsh hot whisky boozy alcohol burn over a big ice cube');

    expect(matches.length).toBeGreaterThan(0);
    // Every match carries a real Crossref-style DOI.
    expect(matches.every((m) => /^10\.\d{4,}\//.test(m.doi))).toBe(true);
    // At least one of the top matches is about dilution/ethanol/spirits.
    const grounded = matches.find((m) => /dilution|ethanol|spirit|distill/.test(m.slug));
    expect(grounded).toBeDefined();
    expect(grounded?.doi).toMatch(/^10\./);
    expect(grounded?.citation.length).toBeGreaterThan(0);
  });

  it('returns an empty array when the signals carry no usable tokens', () => {
    expect(retrieveMechanisms('')).toEqual([]);
    expect(retrieveMechanisms('a an of to')).toEqual([]);
  });

  it('does not cite on a single coincidental generic word (the purple-yam credibility-killer)', () => {
    // An uncovered dish described only with generic outcome words ("sweet", "purple",
    // "flavor") once falsely grounded a coffee-extraction and an oak-aging paper off a
    // lone "sweet"/"flavor" tag hit. The corroboration gate must now cite nothing.
    const ube = retrieveMechanisms(
      'a bright purple yam dessert, soft and sweet and a little milky — what makes that purple flavor',
    );
    expect(ube).toEqual([]);
    // A genuinely covered mechanism (multiple distinct, specific tokens) must still cite.
    const charred = retrieveMechanisms('charred smoky seared beef with a deep browned crust');
    expect(charred.length).toBeGreaterThan(0);
    expect(charred.some((m) => /maillard|brown/.test(m.slug))).toBe(true);
  });

  it('respects the limit and never returns more matches than requested', () => {
    const matches = retrieveMechanisms('harsh hot whisky boozy alcohol burn over a big ice cube', 2);
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it('surfaces a correct "Grounded in:" DOI citation across reconstruction paths, including the mismatch path', () => {
    const userMessage =
      'I miss the harsh hot whisky my abuelo drank over a big ice cube, boozy and full of alcohol burn.';

    const cue = generateMinimumViableNostalgiaCue({
      dossier: icedWhiskyDossier(),
      researchFindings: {
        researchedFacts: [
          'Adding water or ice to a whisky changes which aroma volatiles reach the nose; dilution opens up the spirit.',
        ],
        inferredFacts: [
          'The memory is driven by ethanol burn and the dilution/temperature state of an iced whisky pour.',
        ],
        unknowns: [],
        sourceCount: 1,
        confidence: 'Medium',
      },
      userLocation: 'Long Beach, California',
    });

    // The cue itself carries cited mechanisms straight from the curated DB.
    expect(cue.citedMechanisms?.length ?? 0).toBeGreaterThan(0);
    expect(cue.citedMechanisms?.[0]?.doi).toMatch(/^10\./);

    // The matched (evidence-bounded) answer path surfaces a real DOI grounding line.
    const matched = buildEvidenceBoundedMinimumCueResponse(
      { generate_minimum_viable_nostalgia: cue, collect_food_memory: collectFoodMemory({ memoryText: userMessage }) },
      userMessage,
    );
    expect(matched).toMatch(/Grounded in:[^\n]*doi:10\./);

    // The MISMATCH path (no cue — built straight from the user message, the path the
    // live whisky answer took) still grounds, and grounds CORRECTLY: derived from the
    // clean message signals it cites dilution, not a research-polluted mechanism.
    const mismatch = buildUserMessageMechanismCueResponse(userMessage, {});
    expect(mismatch).toMatch(/Grounded in:[^\n]*doi:10\./);
    expect(mismatch).toMatch(/Scientific Reports|dilution|Karlsson/i);
  });

  it('grounds a model-synthesized answer via the send chokepoint, idempotently', () => {
    const userMessage =
      'I miss the harsh hot whisky my abuelo drank over a big ice cube, boozy and full of alcohol burn.';
    // The live server uses the model to write the final prose; the send() chokepoint
    // appends grounding regardless of how the prose was produced.
    const modelAnswer =
      'Pour a small amount of any affordable whisky over one large ice cube and notice the alcohol prickle first.';
    const grounded = appendGroundedCitation(modelAnswer, userMessage);
    expect(grounded).toMatch(/Grounded in:[^\n]*doi:10\./);
    expect(grounded).toMatch(/dilution|Scientific Reports|Karlsson/i);
    // Idempotent: a second pass does not append a duplicate line.
    expect(appendGroundedCitation(grounded, userMessage)).toBe(grounded);
    // A non-food clarification gets no citation.
    expect(appendGroundedCitation('What color was it?', 'it was kind of reddish')).toBe('What color was it?');
  });
});
