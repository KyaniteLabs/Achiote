import { describe, expect, it } from 'vitest';
import {
  buildReconstructionDossier,
  collectFoodMemory,
  generateMinimumViableNostalgiaCue,
  planDishResearch,
} from '../src/lib/memory-workflow.js';

function puertoRicanDossier() {
  const memory = collectFoodMemory({
    memoryText: "My mom said my Puerto Rican grandma made something that sounded like pass-teh-lay. Maybe plantains or pork.",
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'Pasteles are often wrapped in banana leaves.',
      'Pasteles may use green banana or root-vegetable masa.',
      'Pork or sofrito-seasoned filling is common in many family versions.',
    ],
    inferredFacts: ['The likely memory cue should be tested through aroma and seasoning before a full recipe.'],
  });
}

function carimanolaDossier() {
  const memory = collectFoodMemory({
    memoryText: 'carimanola from Panama; my mom made them but said they were too much work',
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'Carimañolas are Panamanian fried yuca rolls stuffed with seasoned beef picadillo.',
      'The yuca dough is boiled and mashed, then shaped around filling and fried until golden.',
      'Picadillo often uses garlic, onion, cumin, achiote, oregano, tomato paste, and culantro.',
      'The nostalgia-critical contrast is a crispy exterior with chewy yuca and savory filling.',
    ],
    inferredFacts: ['The fastest confirmation cue is picadillo aroma plus a separate crispy yuca bite.'],
  });
}

function spicedSausageMashDossier() {
  const memory = collectFoodMemory({
    memoryText: 'South African place in Savannah served mashed potatoes and a long coiled grey speckled sausage with creamy gravy and a second orange sauce.',
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'Boerewors is a coiled South African sausage commonly seasoned with coriander, black pepper, clove, nutmeg, and vinegar.',
      'The remembered plate had mashed potatoes, creamy gravy, and an orange sauce or relish similar to chakalaka.',
      'Chakalaka is commonly tomato/pepper/onion-based with curry-like spice, sweetness, heat, and acidity.',
    ],
    inferredFacts: [
      'The minimum cue should not require buying boerewors; it should test the spice profile on a cheap protein carrier.',
      'The orange sauce can be tested with a grocery-store tomato relish or salsa adjusted with curry/paprika, acid, and sugar.',
    ],
  });
}

function butterChickenAdaptationDossier() {
  const memory = collectFoodMemory({
    memoryText: 'Butter chicken with cashew gravy, butter, cream, whiskey, chicken, and naan. My family needs nut-free, heart-healthier, halal, vegan, and gluten-free substitutions that keep the soul.',
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'The memory is driven by creamy spiced gravy, fat-soluble aromatics, umami, chicken-like protein texture, and a bread or starch carrier.',
      'Aromatic butter-chicken-style sauces can carry mild sweetness, but the cue family remains savory sauce and composed bite rather than confectionery.',
    ],
    inferredFacts: [
      'The first test should isolate the sauce, fat, spice, protein, and starch mechanisms without turning the adaptation into a full recipe.',
    ],
  });
}

function sesameCandyDossier() {
  const memory = collectFoodMemory({
    memoryText: 'I remember a tan candy that tasted like sesame and crumbled into powder. I had it as a kid outside the US.',
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'Dulce de ajonjolí is a sesame candy that can be brittle, crumbly, and sugar-forward.',
      'The likely memory is driven by toasted sesame aroma and sugar crystallization texture.',
    ],
    inferredFacts: [
      'The first test should be built from cheap local pantry ingredients, not buying the exact suspected candy.',
    ],
  });
}

function peanutBrittleDossier() {
  const memory = collectFoodMemory({
    memoryText: 'A hard brown peanut candy from India sounded like chicky. It shattered, then went sandy and caramel-like.',
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'Peanut chikki is a brittle sweet made from roasted peanuts and cooked sugar or jaggery.',
      'The remembered mechanism is roasted peanut aroma plus hard sugar fracture and sandy caramel finish.',
    ],
    inferredFacts: ['The first local test should use peanuts and cooked sugar logic directly, not unrelated seed or cereal texture.'],
  });
}

function trinidadFishSauceDossier() {
  const memory = collectFoodMemory({
    memoryText: 'Hot fried fish with a sharp orange sauce from Trinidad. I do not know the name.',
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'The likely sensory target is fried fish richness cut by a hot, acidic orange-colored pepper sauce.',
      'Common accessible proxy mechanisms include white fish, lime or vinegar, chile heat, mustard or turmeric/paprika color, garlic, and a green herb aroma.',
    ],
    inferredFacts: ['The cue should test hot-acid-orange sauce contrast on fish before naming the exact dish.'],
  });
}

function beverageDossier(memoryText: string, researchedFacts: string[] = [], inferredFacts: string[] = []) {
  const memory = collectFoodMemory({ memoryText });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts,
    inferredFacts: inferredFacts.length > 0
      ? inferredFacts
      : ['The first test should isolate beverage body, aroma, sweetness, temperature, and serving ritual before naming an exact recipe.'],
  });
}

function confectioneryDossier(memoryText: string, researchedFacts: string[] = [], inferredFacts: string[] = []) {
  const memory = collectFoodMemory({ memoryText });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts,
    inferredFacts: inferredFacts.length > 0
      ? inferredFacts
      : ['The first test should isolate sweetness, aroma, and texture from local pantry ingredients before sourcing exact sweets.'],
  });
}

function cueRecommendationText(cue: ReturnType<typeof generateMinimumViableNostalgiaCue>) {
  return [
    ...cue.ingredients.map((ingredient) => `${ingredient.item} ${ingredient.purpose}`),
    ...cue.components.flatMap((component) => [
      component.criticalElement,
      component.flavorProfile,
      component.localTestWith,
      component.substitutionReason,
    ]),
  ].join(' ').toLowerCase();
}

function fullCueText(cue: ReturnType<typeof generateMinimumViableNostalgiaCue>) {
  return [
    cueRecommendationText(cue),
    ...cue.steps,
    ...cue.accessibilityPrinciples,
    ...cue.substituteLogic,
    cue.whyThisIsMinimum,
  ].join(' ').toLowerCase();
}

describe('minimum viable nostalgia cue', () => {
  it('creates a small food-science cue instead of a full recipe for a named path', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: puertoRicanDossier(),
      researchFindings: {
        researchedFacts: ['Pasteles are often wrapped in banana leaves.'],
        inferredFacts: ['Ingredient signal: banana leaves', 'Ingredient signal: sofrito'],
        unknowns: ['family-specific version'],
        sourceCount: 1,
        confidence: 'Medium',
      },
      userLocation: 'Orlando, FL',
    });

    expect(cue.title).toContain('Minimum viable');
    expect(cue.effortMinutes).toBeLessThanOrEqual(20);
    expect(['bite', 'aroma-cue']).toContain(cue.format);
    expect(cue.accessibilityPrinciples.join(' ')).toContain('grocery-store');
    expect(cue.substituteLogic.join(' ')).toContain('fat-soluble aromatics');
    expect(cue.doesNotPreserve.join(' ')).toContain('exact specialty ingredient');

    expect(cue.components.length).toBeGreaterThanOrEqual(1);
    expect(cue.components.every((c) => c.criticalElement.length > 0)).toBe(true);
    expect(cue.components.every((c) => c.substitutionReason.length > 0)).toBe(true);
    expect(cue.components.some((c) => c.role === 'starch')).toBe(true);
    expect(cue.components.some((c) => c.role === 'protein')).toBe(true);
  });

  it('starts a researched fried starch memory with a composed bite, not a dish-specific cue', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: carimanolaDossier(),
      researchFindings: {
        researchedFacts: [
          'Carimañolas are fried yuca rolls with beef picadillo.',
          'Achiote, cumin, oregano, garlic, and tomato paste season the filling.',
          'The texture contrast is crispy fried yuca outside and chewy starch inside.',
        ],
        inferredFacts: ['The picadillo aroma is the fastest nostalgia trigger.'],
        unknowns: ['family-specific filling'],
        sourceCount: 3,
        confidence: 'High',
      },
      userLocation: 'Long Beach, California',
      constraints: ['Under 20 minutes'],
      maxEffortMinutes: 20,
    });

    expect(cue.title).toContain('composed-bite');
    expect(cue.title).not.toContain('soup');
    expect(cue.title).not.toContain('carimañola');
    expect(cue.title).not.toContain('yuca');
    expect(cue.format).toBe('bite');
    expect(cue.effortMinutes).toBeLessThanOrEqual(20);
    expect(cue.ingredients.map((ingredient) => ingredient.item).join(' ')).toContain('remembered base');
    expect(cue.substituteLogic.join(' ')).toContain('Proteins and fats');
    expect(cue.whyThisIsMinimum).toContain('food-science mechanisms');

    expect(cue.components.length).toBeGreaterThanOrEqual(1);
    expect(cue.components.some((c) => c.role === 'starch')).toBe(true);
    expect(cue.components.some((c) => c.role === 'protein')).toBe(true);
    const starch = cue.components.find((c) => c.role === 'starch')!;
    expect(starch.criticalElement).toContain('gelatinized');
    expect(starch.localTestWith).toContain('Long Beach');
    expect(starch.confidence).toBe('High');
  });

  it('prefers cassava-family local proxies for fried yuca memories instead of generic potato fallback', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: carimanolaDossier(),
      researchFindings: {
        researchedFacts: [
          'Carimañolas are fried yuca rolls with beef picadillo.',
          'The texture contrast is crispy fried yuca outside and chewy cassava starch inside.',
        ],
        inferredFacts: ['The first cue should test cassava-family chew plus browned filling aroma.'],
        unknowns: ['family-specific filling'],
        sourceCount: 2,
        confidence: 'High',
      },
      userLocation: 'Seattle',
      maxEffortMinutes: 20,
    });
    const recommendationText = fullCueText(cue);

    expect(recommendationText).toMatch(/frozen yuca|cassava|tapioca|plantain/);
    expect(recommendationText).toMatch(/crisp|fried|chewy/);
    expect(recommendationText).not.toMatch(/potato.*as the first|first.*potato/);
  });

  it('uses accessible food-science proxy logic for protein, starch, gravy, and sauce memories', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: spicedSausageMashDossier(),
      researchFindings: {
        researchedFacts: [
          'Boerewors is often seasoned with coriander, clove, nutmeg, black pepper, and vinegar.',
          'Chakalaka-like orange relish can include tomato, pepper, onion, curry spice, sweetness, acidity, and heat.',
        ],
        inferredFacts: ['The first test should use grocery-store protein and pantry spices rather than exact imported sausage.'],
        unknowns: ['exact restaurant sauce recipe'],
        sourceCount: 2,
        confidence: 'Medium',
      },
      maxEffortMinutes: 20,
    });

    expect(cue.title).toContain('composed-bite');
    expect(cue.effortMinutes).toBeLessThanOrEqual(15);
    expect(cue.ingredients.map((ingredient) => ingredient.item).join(' ')).toContain('accessible protein');
    expect(cue.whyThisIsMinimum).toContain('food-science mechanisms');
    expect(cue.accessibilityPrinciples.join(' ')).toContain('grocery-store carriers');
    expect(cue.substituteLogic.join(' ')).toContain('fat-soluble aromatics');
    expect(cue.title).not.toContain('boerewors');
    expect(cue.title).not.toContain('sausage');

    expect(cue.components.length).toBeGreaterThanOrEqual(2);
    expect(cue.components.some((c) => c.role === 'starch')).toBe(true);
    expect(cue.components.some((c) => c.role === 'protein')).toBe(true);
    expect(cue.components.some((c) => c.role === 'sauce')).toBe(true);
    for (const comp of cue.components) {
      expect(comp.criticalElement.length).toBeGreaterThan(0);
      expect(comp.flavorProfile.length).toBeGreaterThan(0);
      expect(comp.substitutionReason.length).toBeGreaterThan(0);
    }
  });

  it('builds confectionery tests from local pantry proxies instead of buying the suspected candy', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: sesameCandyDossier(),
      researchFindings: {
        researchedFacts: [
          'Dulce de ajonjolí is made around sesame aroma and sugar texture.',
          'Sesame candies can be brittle, crumbly, or crystalline depending on syrup and seed ratio.',
        ],
        inferredFacts: ['The first cue should recreate toasted seed aroma plus sugar crystallization from local ingredients.'],
        unknowns: ['exact country and family brand'],
        sourceCount: 2,
        confidence: 'Medium',
      },
      userLocation: 'Cleveland, Ohio',
      maxEffortMinutes: 10,
    });
    const recommendationText = fullCueText(cue);

    expect(cue.title).toContain('sweet-texture');
    expect(cue.effortMinutes).toBeLessThanOrEqual(10);
    expect(recommendationText).toMatch(/granulated sugar|plain sugar/);
    expect(recommendationText).toMatch(/sesame|seed|coconut|oat|cracker/);
    expect(recommendationText).toContain('do not buy the exact');
    expect(recommendationText).not.toMatch(/buy .*dulce de ajonjol[ií]|latin grocery|international aisle|grocery-store sweet matching/);
  });

  it('does not let generic sweetness flip savory adaptation memories into confectionery cues', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: butterChickenAdaptationDossier(),
      researchFindings: {
        researchedFacts: [
          'The savory memory cue is creamy spiced gravy with fat-soluble aromatics, umami, and bread/starch contrast.',
          'Mild sweetness can appear in onion, tomato, coconut, or cream substitutes, but it is not a candy or dessert memory.',
        ],
        inferredFacts: ['The cue should stay a composed savory bite with sauce/protein/starch mechanics.'],
        unknowns: ['exact family spice blend'],
        sourceCount: 2,
        confidence: 'Medium',
      },
      constraints: ['nut-free', 'heart-healthier', 'halal', 'vegan', 'gluten-free'],
      maxEffortMinutes: 10,
    });
    const recommendationText = fullCueText(cue);

    expect(cue.title).toContain('composed-bite');
    expect(cue.title).not.toContain('sweet-texture');
    expect(recommendationText).toMatch(/protein|umami|fat|sauce|spice|starch|carrier/i);
    expect(recommendationText).not.toMatch(/granulated sugar|crushed sugar cube|suspected candy/i);
  });

  it('makes peanut brittle/chikki tests peanut-and-caramel specific instead of generic seed texture only', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: peanutBrittleDossier(),
      researchFindings: {
        researchedFacts: [
          'Peanut chikki and related brittles use roasted peanuts with cooked sugar or jaggery.',
          'The sensory target is roasted peanut aroma, hard snap, and caramelized sugar.',
        ],
        inferredFacts: ['The local proxy should test peanut plus sugar fracture directly.'],
        unknowns: ['exact jaggery depth'],
        sourceCount: 2,
        confidence: 'Medium',
      },
      userLocation: 'Denver',
      maxEffortMinutes: 10,
    });
    const recommendationText = fullCueText(cue);

    expect(recommendationText).toMatch(/peanut/);
    expect(recommendationText).toMatch(/brown sugar|jaggery|caramel|syrup/);
    expect(recommendationText).toMatch(/snap|shatter|fracture|brittle/);
    expect(recommendationText).toContain('do not buy the exact');
  });

  it('makes sharp orange fish sauce cues hot-acid-herb specific with ordinary groceries', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: trinidadFishSauceDossier(),
      researchFindings: {
        researchedFacts: [
          'The memory points to fried fish with hot, acidic orange pepper sauce.',
          'Ordinary grocery proxies can use lime or vinegar, hot sauce or chile, mustard, paprika or turmeric, garlic, and cilantro.',
        ],
        inferredFacts: ['The sauce contrast should be tested on a small piece of white fish.'],
        unknowns: ['exact pepper and herb'],
        sourceCount: 2,
        confidence: 'Low',
      },
      userLocation: 'Portland',
      maxEffortMinutes: 15,
    });
    const recommendationText = fullCueText(cue);

    expect(recommendationText).toMatch(/fish|white fish/);
    expect(recommendationText).toMatch(/lime|vinegar/);
    expect(recommendationText).toMatch(/hot sauce|chile|pepper/);
    expect(recommendationText).toMatch(/mustard|paprika|turmeric|orange/);
    expect(recommendationText).toMatch(/cilantro|green herb/);
    expect(recommendationText).not.toMatch(/mango salsa/);
  });

  it.each([
    {
      label: 'unnamed sesame crumble',
      memoryText: 'A tan sesame sweet from another country turned powdery on my tongue, but I do not know the name.',
      researchedFacts: ['Several sesame sweets use sugar crystallization and toasted seed aroma.'],
      banned: /buy .*sesame sweet|sesame candy store|asian market|international aisle/,
    },
    {
      label: 'unnamed coconut sugar sweet',
      memoryText: 'A white coconut dessert from a school festival abroad was grainy and melted into sugar crystals.',
      researchedFacts: ['Cocada and other coconut sweets can be grainy, fibrous, and sugar-forward.'],
      banned: /buy .*cocada|latin grocery|caribbean market|international aisle/,
    },
    {
      label: 'grainy milk candy',
      memoryText: 'I miss a pale milk candy from my childhood trip that was crumbly, sweet, and a little buttery.',
      researchedFacts: ['Milk sweets such as pastillas, barfi, or milk fudge can be grainy from sugar or milk solids.'],
      banned: /buy .*pastillas|buy .*barfi|indian sweets shop|filipino store|international aisle/,
    },
    {
      label: 'peanut jaggery brittle',
      memoryText: 'A brown peanut candy overseas shattered first, then went sandy and caramel-like.',
      researchedFacts: ['Peanut chikki and related brittle sweets use roasted nuts and cooked sugar or jaggery.'],
      banned: /buy .*chikki|buy .*peanut candy|indian grocery|international aisle/,
    },
  ])('keeps first confectionery cue local and mechanism-first for $label', ({ memoryText, researchedFacts, banned }) => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: confectioneryDossier(memoryText, researchedFacts),
      researchFindings: {
        researchedFacts,
        inferredFacts: ['The cue should test crystallized sweetness, aroma release, and mouthfeel from local ingredients first.'],
        unknowns: ['exact country', 'exact family brand'],
        sourceCount: researchedFacts.length,
        confidence: 'Low',
      },
      userLocation: 'Madison, Wisconsin',
      maxEffortMinutes: 10,
    });
    const recommendationText = fullCueText(cue);

    expect(cue.title).toContain('sweet-texture');
    expect(cue.effortMinutes).toBeLessThanOrEqual(10);
    expect(recommendationText).toMatch(/granulated sugar|plain sugar|crushed sugar cube/);
    expect(recommendationText).toMatch(/local pantry|ordinary grocery|one spoon|one teaspoon/);
    expect(recommendationText).toContain('do not buy the exact');
    expect(recommendationText).not.toMatch(banned);
  });

  it('uses the soup cue for unresolved sour soup memories', () => {
    const memory = collectFoodMemory({ memoryText: 'I remember a warm sour smell with dill but not the dish name.' });
    const dossier = buildReconstructionDossier({ memory, researchPlan: planDishResearch(memory) });
    const cue = generateMinimumViableNostalgiaCue({ dossier, maxEffortMinutes: 8 });

    expect(cue.effortMinutes).toBeLessThanOrEqual(8);
    expect(cue.title).toContain('sour-herb soup');
    expect(cue.steps.join(' ')).toMatch(/dill|herb|sour/i);
    expect(cue.confidence).toBe('Low');

    expect(cue.components.length).toBeGreaterThanOrEqual(1);
    expect(cue.components.every((c) => c.criticalElement.length > 0)).toBe(true);
  });

  it('uses sour-herb soup mechanisms instead of generic liquid placeholders', () => {
    const memory = collectFoodMemory({ memoryText: 'My neighbor remembered a tart green-herb broth with soft pale potato or egg pieces, but nobody knows the exact name.' });
    const dossier = buildReconstructionDossier({
      memory,
      researchPlan: planDishResearch(memory),
      researchedFacts: [
        'Sour herb soups often separate pickle or fermented-brine sourness from dairy tang, herb aroma, and potato or egg body.',
      ],
      inferredFacts: ['The cue should test dill aroma, brine-like acid, warm liquid body, and pale starch/egg texture without naming the exact soup as certain.'],
    });
    const cue = generateMinimumViableNostalgiaCue({ dossier, maxEffortMinutes: 10 });
    const recommendationText = fullCueText(cue);

    expect(cue.format).toBe('sip');
    expect(recommendationText).toMatch(/dill/);
    expect(recommendationText).toMatch(/pickle|brine|ferment|vinegar|sour/);
    expect(recommendationText).toMatch(/potato|egg|starch|pale/);
    expect(recommendationText).not.toMatch(/dominant aromatic|neutral liquid carrier|another cheap neutral liquid carrier/);
  });

  it('does not route generic pork soup signals to the pasteles cue', () => {
    const memory = collectFoodMemory({ memoryText: 'My uncle remembered pork broth with dill and sour greens.' });
    const dossier = buildReconstructionDossier({
      memory,
      researchPlan: planDishResearch(memory),
      researchedFacts: ['The remembered dish involved pork broth, dill, and sour greens.'],
    });
    const cue = generateMinimumViableNostalgiaCue({ dossier });

    expect(cue.title).not.toContain('pasteles');
    expect(cue.format).toBe('sip');

    expect(cue.components.length).toBeGreaterThanOrEqual(1);
  });

  it('treats rice-cinnamon drink memories as first-class beverages instead of generic soup or dish cues', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: beverageDossier(
        'My abuela made a cold rice-cinnamon drink, milky and sweet, poured over ice.',
        [
          'Horchata-style drinks often preserve rice body, cinnamon aroma, sweetness, dilution, chill, and the over-ice serving ritual.',
          'The memory should be tested as a beverage, not as rice pudding or soup.',
        ],
      ),
      researchFindings: {
        researchedFacts: ['Rice-cinnamon drinks are often defined by starch body, spice extraction, sugar level, dilution, and cold serving temperature.'],
        inferredFacts: ['The minimum cue should be a small sip that tests beverage body and serving temperature.'],
        unknowns: ['exact household recipe'],
        sourceCount: 2,
        confidence: 'Medium',
      },
      userLocation: 'Phoenix',
      maxEffortMinutes: 12,
    });
    const recommendationText = fullCueText(cue);

    expect(cue.title).toContain('beverage');
    expect(cue.title).not.toContain('soup');
    expect(cue.format).toBe('sip');
    expect(cue.effortMinutes).toBeLessThanOrEqual(12);
    expect(recommendationText).toMatch(/rice|oat|milk|plant milk|starch/);
    expect(recommendationText).toMatch(/cinnamon|spice extraction|steep/);
    expect(recommendationText).toMatch(/ice|chill|temperature|dilution/);
    expect(recommendationText).toMatch(/sweetness|sugar/);
    expect(cue.components.some((component) => component.role === 'beverage')).toBe(true);
  });

  it('uses grain-drink mechanisms as reference signals instead of generic beverage language', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: beverageDossier(
        'My family called it a cold grain water. It was thin, barely sweet, maybe barley or rice, with cinnamon or lime and a lot of ice.',
        [
          'The internal reference family is grain beverage: rice-cinnamon, barley-water, and other cereal-drink memories share starch body, spice or grain aroma, sweetness, dilution, chill, and ice ritual.',
        ],
      ),
      maxEffortMinutes: 10,
    });
    const recommendationText = fullCueText(cue);

    expect(cue.title).toContain('beverage');
    expect(recommendationText).toMatch(/rice|cinnamon|barley|grain|lime|citrus/);
    expect(recommendationText).toMatch(/ice|cold|chill|dilution/);
    expect(recommendationText).not.toMatch(/dominant beverage aroma|strongest remembered aroma|another remembered spice\/aroma/);
  });

  it('maps Spanish rice-cinnamon beverage clues to grain-drink mechanisms', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: beverageDossier(
        'Mi abuela made una bebida fria de arroz con canela, muy ligera, served over hielo.',
        [
          'Spanish rice-cinnamon beverage memories should map arroz/canela/hielo to grain body, spice aroma, dilution, and cold serving ritual.',
        ],
      ),
      maxEffortMinutes: 10,
    });
    const recommendationText = fullCueText(cue);

    expect(cue.title).toContain('beverage');
    expect(recommendationText).toMatch(/arroz|rice|canela|cinnamon|hielo|ice|cold/i);
    expect(recommendationText).not.toMatch(/user-named fruit, spice, herb|user-named grain-spice cue|strongest remembered aroma/i);
  });

  it('handles carbonated drink memories through fizz, acid, sugar, temperature, and aroma', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: beverageDossier(
        'A bright red fizzy soda from a street cart, very cold, sweet, tart, maybe fruit or kola.',
        [
          'Carbonated nostalgic drinks depend on carbonation bite, acid-sugar balance, aroma syrup, cold temperature, and serving ritual.',
        ],
      ),
      researchFindings: {
        researchedFacts: ['A soda-like beverage cue should test carbonation separately from syrup aroma and sweetness.'],
        inferredFacts: ['Use ordinary seltzer and pantry acid/sugar/aroma before sourcing the exact soda brand.'],
        unknowns: ['exact brand', 'exact fruit or kola aroma'],
        sourceCount: 1,
        confidence: 'Low',
      },
      maxEffortMinutes: 8,
    });
    const recommendationText = fullCueText(cue);

    expect(cue.title).toContain('beverage');
    expect(cue.format).toBe('sip');
    expect(recommendationText).toMatch(/seltzer|carbonation|fizz|sparkling/);
    expect(recommendationText).toMatch(/acid|tart|citrus/);
    expect(recommendationText).toMatch(/sugar|sweetness|syrup/);
    expect(recommendationText).toMatch(/cold|ice|temperature/);
    expect(recommendationText).toContain('do not buy the exact drink');
  });

  it('treats barley and cebada drink memories as cold cereal beverages', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: beverageDossier(
        'My tia called it agua de cebada or aguita de ceba. It was a cold, watery, barely sweet barley drink with lime over ice.',
        [
          'Agua de cebada should be tested as a cereal drink memory, not as porridge or a generic sweet texture.',
          'The strongest signals are barley or cebada, cold dilution, lime brightness, low sweetness, and the over-ice serving ritual.',
        ],
      ),
      researchFindings: {
        researchedFacts: ['Barley-water style drinks preserve toasted grain aroma, watery body, citrus brightness, low sweetness, dilution, and cold serving temperature.'],
        inferredFacts: ['The minimum cue should be a small cold sip that tests barley or grain-water body with lime.'],
        unknowns: ['exact household spelling', 'exact grain preparation'],
        sourceCount: 2,
        confidence: 'Medium',
      },
      userLocation: 'United States',
      maxEffortMinutes: 12,
    });
    const recommendationText = fullCueText(cue);

    expect(cue.title).toContain('beverage');
    expect(cue.format).toBe('sip');
    expect(cue.ingredients[0]?.item.toLowerCase()).toMatch(/barley|cebada|grain/);
    expect(recommendationText).toMatch(/lime|citrus|acid/);
    expect(recommendationText).toMatch(/cold|ice|chill|temperature|dilution/);
    expect(cue.components.some((component) => component.role === 'beverage')).toBe(true);
  });

  it('does not classify iced baked goods as beverages', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: confectioneryDossier(
        'I remember an iced cake from a neighborhood bakery, soft and sweet with a thin white icing.',
        ['The memory points to a baked sweet with icing texture.'],
      ),
      researchFindings: {
        researchedFacts: ['Iced cakes are baked goods where crumb texture and icing sweetness carry the memory.'],
        inferredFacts: ['The cue should test cake crumb and icing sweetness.'],
        unknowns: ['exact bakery style'],
        sourceCount: 1,
        confidence: 'Low',
      },
      maxEffortMinutes: 10,
    });

    expect(cue.title).not.toContain('beverage');
    expect(cue.format).not.toBe('sip');
    expect(fullCueText(cue)).toMatch(/cake|starch|sweet|icing|bite/);
  });

  it('rewrites composed-bite ingredients and components for vegan and halal constraints', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: spicedSausageMashDossier(),
      constraints: ['vegan', 'halal'],
      maxEffortMinutes: 20,
    });
    const ingredients = cue.ingredients.map((ingredient) => ingredient.item).join(' ').toLowerCase();
    const recommendationText = cueRecommendationText(cue);

    expect(recommendationText).not.toMatch(/meat|pork|chicken|lamb|dairy|butter|\bmilk\b|rendered fat|certified compliant (?:protein|meat)/);
    expect(ingredients).toMatch(/bean|mushroom|tofu|plant-based|olive oil/);
    expect(cue.safetyNotes.join(' ').toLowerCase()).toContain('halal');
  });

  it('qualifies animal proteins instead of naming pork or chicken for halal constraints', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: spicedSausageMashDossier(),
      constraints: ['halal'],
      maxEffortMinutes: 20,
    });
    const recommendationText = cueRecommendationText(cue);

    expect(recommendationText).not.toMatch(/ground pork|pork|chicken thigh|rendered fat/);
    expect(recommendationText).toMatch(/certified compliant (?:protein|meat|fat)/);
  });

  it('rewrites carriers for common gluten-free constraint phrasing', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: carimanolaDossier(),
      constraints: ['no gluten'],
      maxEffortMinutes: 20,
    });
    const ingredients = cue.ingredients.map((ingredient) => ingredient.item).join(' ').toLowerCase();
    const recommendationText = cueRecommendationText(cue);

    expect(recommendationText).not.toMatch(/bread|flour|tortilla/);
    expect(ingredients).toMatch(/rice|potato|corn|certified gluten-free/);
  });

  it('rewrites liquid cues for dairy-free and peanut allergy constraints', () => {
    const memory = collectFoodMemory({ memoryText: 'warm sour soup with dill and creamy body' });
    const dossier = buildReconstructionDossier({ memory, researchPlan: planDishResearch(memory) });
    const cue = generateMinimumViableNostalgiaCue({
      dossier,
      constraints: ['dairy-free', 'peanut allergy'],
      maxEffortMinutes: 12,
    });
    const recommendationText = cueRecommendationText(cue);
    const safety = cue.safetyNotes.join(' ').toLowerCase();

    expect(recommendationText).not.toMatch(/\bdairy\b|\bbutter\b|cow's milk|peanut/);
    expect(`${recommendationText} ${safety}`).toMatch(/water|broth|olive oil|clean utensils|cross-contact/);
    expect(safety).toContain('peanut allergy');
  });

  it('removes coconut and dairy cues when plural tree nut allergy phrasing overlaps dairy-free', () => {
    const memory = collectFoodMemory({ memoryText: 'warm sour soup with dill and creamy body' });
    const dossier = buildReconstructionDossier({ memory, researchPlan: planDishResearch(memory) });
    const cue = generateMinimumViableNostalgiaCue({
      dossier,
      constraints: ['allergic to tree nuts', 'no dairy'],
      maxEffortMinutes: 12,
    });
    const recommendationText = cueRecommendationText(cue);

    expect(recommendationText).not.toMatch(/coconut|peanut|tree nut|\bnut\b|\bdairy\b|\bbutter\b|\bmilk\b|yogurt/);
    expect(recommendationText).toMatch(/water|broth|olive oil|plant-based|oil-herb/);
  });

  it('clamps max effort to a positive number', () => {
    const cue = generateMinimumViableNostalgiaCue({ dossier: puertoRicanDossier(), maxEffortMinutes: -5 });

    expect(cue.effortMinutes).toBeGreaterThan(0);
  });
});
