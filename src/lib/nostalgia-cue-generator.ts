import type {
  Confidence,
  CueComponent,
  MinimumViableNostalgiaCue,
  MinimumViableNostalgiaInput,
} from './types.js';
import { adaptCueProfileForConstraints } from './constraint-adapter.js';
import { runCueProfileEngine, type FoodScienceCueProfile } from './cue-profile-engine.js';
import { unique, escapeRegExp, normalizeForLooseMatch } from './food-memory-text.js';
import { CONCEPT_ALIASES } from './food-memory-collector.js';


function textSignals(input: MinimumViableNostalgiaInput): string {
  return stripNegatedSignalTerms([
    input.dossier.evidenceLedger.userSaid.join(' '),
    input.dossier.evidenceLedger.researched.join(' '),
    input.dossier.evidenceLedger.inferred.join(' '),
    input.researchFindings?.researchedFacts.join(' ') ?? '',
    input.researchFindings?.inferredFacts.join(' ') ?? '',
    input.dossier.hypotheses.map((hypothesis) => hypothesis.name).join(' '),
  ].join(' ').toLowerCase());
}

function stripNegatedSignalTerms(text: string): string {
  return text
    .replace(/\b(?:not|no)\s+[\p{L}\p{M}\s'-]{1,80}?(?=(?:[:;,.!?]|$))/giu, ' ')
    .replace(/\b(?:without|wasn['']?t|weren['']?t|isn['']?t|aren['']?t|was\s+not|were\s+not|is\s+not|are\s+not)\s+[\p{L}\p{M}\s'-]{1,80}?(?=(?:[:;,.!?]|$))/giu, ' ');
}

const COMPONENT_ROLES = {
  starch: {
    keywords: 'rice|potato|potatoes|mash|masa|dough|bread|yuca|cassava|plantain|dumpling|noodle|bean|beans|starch|tortilla|cake|acorn|jelly|gelled',
    criticalElement: 'gelatinized texture and sauce absorption',
    flavorProfile: 'neutral to slightly sweet, soft or chewy mouthfeel',
    localTestWith: 'any grocery-store starch: potato, rice, bread, or flour tortilla',
    substitutionReason: 'Starch gelatinization produces similar texture and sauce-carrying capacity regardless of the specific source',
  },
  protein: {
    keywords: 'meat|sausage|fish|shark|beef|pork|chicken|lamb|cheese|protein|filling|ground',
    criticalElement: 'fat-rendered Maillard crust and spice-carrying fat',
    flavorProfile: 'savory umami, browned fat, salt, and any spice bloom carried in rendered fat',
    localTestWith: 'any accessible protein: ground pork, chicken thigh, or firm tofu pan-seared in oil',
    substitutionReason: 'Proteins that render fat carry Maillard compounds and fat-soluble aromatics the same way regardless of cut or species',
  },
  sauce: {
    keywords: 'sauce|gravy|relish|chutney|salsa|condiment|dip|orange|creamy',
    criticalElement: 'acid-fat-salt balance and aromatic contrast against richness',
    flavorProfile: 'variable, may be tomato-based, dairy-based, oil-herb, or vinegar-forward',
    localTestWith: 'grocery-store salsa, tomato paste with vinegar and sugar, or yogurt with herbs',
    substitutionReason: 'Sauces are balance systems of fat, acid, sugar, salt, and aromatics; matching the balance preserves the contrast even with different base ingredients',
  },
  vegetable: {
    keywords: 'vegetable|pepper|onion|greens|cabbage|lettuce|tomato|carrot|corn',
    criticalElement: 'crunch, sweetness, or char that breaks up richness',
    flavorProfile: 'fresh or cooked sweetness, slight bitterness, or charred smokiness',
    localTestWith: 'any grocery-store vegetable that can be charred, sauteed, or served raw',
    substitutionReason: 'Vegetable nostalgia is usually about texture contrast and char sweetness, not the specific variety',
  },
  broth: {
    keywords: 'soup|stew|broth|stock|porridge|consomme',
    criticalElement: 'volatile aroma release in a warm liquid carrier',
    flavorProfile: 'layered body from dissolved proteins, salt, fat, and long-cooked aromatics',
    localTestWith: 'any warm broth or stock with a pinch of the remembered spice',
    substitutionReason: 'Warm liquid releases volatile aromatics the same way regardless of the stock base; the nostalgia is in the aroma chemistry',
  },
  beverage: {
    keywords: 'drink|beverage|soda|fizzy|carbonated|sparkling|seltzer|horchata|agua fresca|agua de cebada|cebada|ceba|barley|atole|champurrado|lassi|chai|tea|coffee|espresso|cocoa|mate|milkshake|smoothie|tepache|sorrel|mauby|akasan|pinol|pinole|kombucha|over ice',
    criticalElement: 'serving temperature, dilution, aroma extraction, dissolved body, and sip ritual',
    flavorProfile: 'balanced sweetness, acid, bitterness or spice, carried by water, dairy, grain starch, fruit, or carbonation',
    localTestWith: 'one small sip from water, milk or plant milk, seltzer, or juice plus a pantry aroma cue',
    substitutionReason: 'Beverage nostalgia is often carried by extraction, dilution, temperature, carbonation, sweetness, acid, and aroma release rather than the exact bottled drink',
  },
  confectionery: {
    keywords: 'caramel|dulce de leche|manjar|fudge|barfi|halva|baklava|mochi|candy|sweet|dessert|confection|cookie|biscuit|nougat|turrón|taffy|melcocha|cocada|flan|custard|pudding|chocolate|pastillas',
    criticalElement: 'sugar crystallization structure and fat-soluble aroma delivery in a solid or semi-solid matrix',
    flavorProfile: 'sweetness balanced by dairy fat, caramelization bitterness, or aromatic spice; texture from crystalline, chewy, or crumbly structure',
    localTestWith: 'a one-spoon local proxy: granulated sugar plus a safe toasted seed, coconut, oat, or crushed plain cracker texture',
    substitutionReason: 'Confectionery nostalgia is driven by sugar crystallization texture, aroma release, and fat or seed mouthfeel; these can be tested from local pantry parts before buying the exact regional sweet',
  },
} as const;

type ComponentRole = keyof typeof COMPONENT_ROLES;

const ROLE_ORDER: ComponentRole[] = ['starch', 'protein', 'sauce', 'vegetable', 'broth', 'beverage', 'confectionery'];

function sanitizeLocation(raw?: string): string {
  if (!raw) return 'at any grocery store';
  const trimmed = raw.trim();
  if (trimmed.length <= 80) return `near ${trimmed}`;
  const truncated = trimmed.slice(0, 80);
  const lastSep = Math.max(truncated.lastIndexOf(','), truncated.lastIndexOf(' '));
  return `near ${truncated.slice(0, lastSep > 0 ? lastSep : 80)}`;
}

function decomposeIntoComponents(signals: string, userLocation?: string, overallConfidence?: Confidence): CueComponent[] {
  const locationPhrase = sanitizeLocation(userLocation);
  let components: CueComponent[] = [];

  for (const role of ROLE_ORDER) {
    const def = COMPONENT_ROLES[role];
    if (!hasAnySignal(signals, [wordSignal(def.keywords)])) continue;

    components.push({
      role,
      criticalElement: specificCriticalElement(role, signals, def.criticalElement),
      flavorProfile: specificFlavorProfile(role, signals, def.flavorProfile),
      localTestWith: `${specificLocalTestWith(role, signals, def.localTestWith)} ${locationPhrase}`,
      substitutionReason: def.substitutionReason,
      confidence: overallConfidence ?? 'Low',
    });
  }

  if (components.length === 0) {
    components.push({
      role: 'overall',
      criticalElement: 'the dominant sensory mechanism: aroma, texture, sauce, fat, acid, or contrast',
      flavorProfile: 'unknown until one variable is isolated and tested',
      localTestWith: `one safe pantry ingredient ${locationPhrase}`,
      substitutionReason: 'Without a known mechanism, any substitution is guesswork; isolate one sensory variable first',
      confidence: 'Low',
    });
  }

  const confectionerySignals = signals.replace(/\b(?:not|rather than|instead of)\s+(?:a |an )?(?:candy|dessert|confection(?:ery)?|cookie|biscuit|sweet(?:ness)?|sweet-texture)(?:\s+or\s+(?:a |an )?(?:candy|dessert|confection(?:ery)?|cookie|biscuit|sweet(?:ness)?|sweet-texture))*\b/gi, '');
  const hasStrongConfectionery = hasAnySignal(confectionerySignals, [wordSignal('caramel|dulce de leche|manjar|fudge|barfi|halva|baklava|mochi|candy|dessert|confection|cookie|biscuit|nougat|turrón|taffy|melcocha|cocada|flan|custard|pudding|chocolate|pastillas|milk candy|grainy/crystalline texture|powdery')]);
  const hasSavoryCueFamily = components.some((component) => ['starch', 'protein', 'sauce', 'vegetable', 'broth'].includes(component.role))
    || hasAnySignal(signals, [wordSignal('savory|curry|gravy|spiced|seasoned')]);
  if (!hasStrongConfectionery && hasSavoryCueFamily) {
    components = components.filter((component) => component.role !== 'confectionery');
  }

  if (components.length === 0) {
    components.push({
      role: 'overall',
      criticalElement: 'the dominant sensory mechanism: aroma, texture, sauce, fat, acid, or contrast',
      flavorProfile: 'unknown until one variable is isolated and tested',
      localTestWith: `one safe pantry ingredient ${locationPhrase}`,
      substitutionReason: 'Without a known mechanism, any substitution is guesswork; isolate one sensory variable first',
      confidence: 'Low',
    });
  }

  return components;
}

function hasAnySignal(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function wordSignal(words: string): RegExp {
  const escaped = words.split('|').map(w => escapeRegExp(w)).join('|');
  return new RegExp(`\\b(${escaped})\\b`, 'i');
}

function signalIncludes(signals: string, words: string): boolean {
  const normalizedSignals = signals.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return hasAnySignal(normalizedSignals, [wordSignal(words)]);
}

function conceptIncludes(signals: string, concepts: string[]): boolean {
  const normalizedSignals = normalizeForLooseMatch(signals);
  return concepts.some((concept) => {
    const aliases = CONCEPT_ALIASES[concept] ?? [concept];
    return aliases.some((alias) => {
      const normalizedAlias = normalizeForLooseMatch(alias);
      if (normalizedAlias.length <= 2) return false;
      if (/^[a-z0-9 ]+$/i.test(normalizedAlias)) {
        return new RegExp(`(?:^|\\s)${escapeRegExp(normalizedAlias)}(?:$|\\s)`, 'i').test(normalizedSignals);
      }
      return normalizedSignals.includes(normalizedAlias);
    });
  });
}

function specificCriticalElement(role: ComponentRole, signals: string, fallback: string): string {
  if (role === 'starch' && signalIncludes(signals, 'yuca|cassava|tapioca')) {
    return 'cassava-family chew, gelatinized starch body, and crisp fried surface';
  }
  if (role === 'starch' && signalIncludes(signals, 'acorn|jelly|gelled|slippery')) {
    return 'cool gel texture, slippery bite, nutty grain aroma, and sauce cling';
  }
  if (role === 'protein' && signalIncludes(signals, 'fish|shark')) {
    return 'fried fish richness, browned edge aroma, and sauce-carrying fat';
  }
  if (role === 'beverage' && signalIncludes(signals, 'fizzy|carbonated|sparkling|seltzer|soda')) {
    return 'carbonation bite, acid-sugar balance, syrup aroma, cold temperature, and serving ritual';
  }
  if (role === 'beverage' && (signalIncludes(signals, 'horchata|agua de cebada|ceba|atole|champurrado|pinol|pinole') || conceptIncludes(signals, ['rice', 'barley', 'corn', 'cinnamon', 'grain']))) {
    return 'grain or starch body, spice extraction, sweetness, dilution, serving temperature, and sip ritual';
  }
  if (role === 'beverage' && signalIncludes(signals, 'tea|chai|coffee|espresso|mate|cocoa')) {
    return 'steeped extraction strength, tannin or roast bitterness, sweetness, milk/body, temperature, and aroma release';
  }
  if (role === 'sauce' && signalIncludes(signals, 'orange|hot|pepper|chile|lime|vinegar|acid|sharp')) {
    return 'hot-acid sauce contrast: chile heat, citrus/vinegar brightness, salt, and orange color cue';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'peanut|jaggery|brittle|chikki')) {
    return 'roasted peanut aroma, hard sugar snap, and sandy caramel finish';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'coconut|cocada|bukayo')) {
    return 'toasted coconut or seed aroma, grainy sugar crystallization, and chewy or sticky matrix texture';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'grainy|crystalline|powdery|crumbly')) {
    return 'sugar crystallization texture (grainy, crumbly, or powdery) plus fat or seed aroma that binds the sweet';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'chewy|sticky|gummy|nougat|taffy|melcocha')) {
    return 'chewy or sticky sugar matrix with toasted seed, nut, dairy, or spice aroma carried in the stretch';
  }
  return fallback;
}

function specificFlavorProfile(role: ComponentRole, signals: string, fallback: string): string {
  if (role === 'starch' && signalIncludes(signals, 'yuca|cassava|tapioca')) {
    return 'neutral-sweet cassava chew with a crisp exterior and soft starchy middle';
  }
  if (role === 'starch' && signalIncludes(signals, 'acorn|jelly|gelled|slippery')) {
    return 'cool, slippery, softly gelled, lightly nutty, and carried by salty-acid dressing';
  }
  if (role === 'protein' && signalIncludes(signals, 'fish|shark')) {
    return 'savory white-fish richness, browned oil aroma, salt, and a clean surface for sharp sauce';
  }
  if (role === 'beverage' && signalIncludes(signals, 'fizzy|carbonated|sparkling|seltzer|soda')) {
    return 'cold fizz, tart acid, syrupy sweetness, fruit or kola aroma, and a short carbonation prickle';
  }
  if (role === 'beverage' && (signalIncludes(signals, 'horchata|agua de cebada|ceba|atole|champurrado|pinol|pinole') || conceptIncludes(signals, ['rice', 'barley', 'corn', 'cinnamon', 'grain']))) {
    return 'milky or grainy body, cinnamon or warm spice, gentle sweetness, and dilution adjusted by ice or heat';
  }
  if (role === 'beverage' && signalIncludes(signals, 'tea|chai|coffee|espresso|mate|cocoa')) {
    return 'steeped or brewed bitterness, spice or roast aroma, sweetness, and dairy or plant-milk body if remembered';
  }
  if (role === 'sauce' && signalIncludes(signals, 'orange|hot|pepper|chile|lime|vinegar|acid|sharp')) {
    return 'sharp, salty, chile-hot, citrusy or vinegar-bright, with mustard/paprika/turmeric color and garlic-herb aroma';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'peanut|jaggery|brittle|chikki')) {
    return 'roasted peanut, brown sugar or jaggery caramel, hard snap, then sandy melt';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'coconut|cocada|bukayo')) {
    return 'toasted coconut or seed aroma, grainy sugar crystal, chewy or sticky body, and optional dairy fat';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'grainy|crystalline|powdery|crumbly')) {
    return 'sugar crystallization stage (grainy, crumbly, or powdery) with toasted seed, nut, or dairy aroma';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'chewy|sticky|gummy|nougat|taffy|melcocha')) {
    return 'stretchy or sticky sugar matrix, toasted seed or nut aroma, and optional spice or dairy accent';
  }
  return fallback;
}

function specificLocalTestWith(role: ComponentRole, signals: string, fallback: string): string {
  if (role === 'starch' && signalIncludes(signals, 'yuca|cassava|tapioca')) {
    return 'frozen yuca/cassava, canned yuca, tapioca-starch paste, or plantain crisped in oil';
  }
  if (role === 'starch' && signalIncludes(signals, 'acorn|jelly|gelled|slippery')) {
    return 'a tiny chilled cube of plain gelatin, agar, mung-bean jelly, or another safe neutral gel with sesame-vinegar dressing';
  }
  if (role === 'protein' && signalIncludes(signals, 'fish|shark')) {
    return 'a small piece of white fish, canned fish, or firm tofu pan-seared in oil';
  }
  if (role === 'beverage' && signalIncludes(signals, 'fizzy|carbonated|sparkling|seltzer|soda')) {
    return 'chilled plain seltzer with a teaspoon syrup or sugar, a few drops citrus acid, and one fruit, kola, vanilla, or spice aroma';
  }
  if (role === 'beverage' && signalIncludes(signals, 'agua de cebada|cebada|ceba|barley')) {
    return 'barley water, toasted barley tea, or water with a tiny barley/oat/rice-starch slurry, served cold with lime or ice as remembered';
  }
  if (role === 'beverage' && (signalIncludes(signals, 'horchata|atole|champurrado|pinol|pinole') || conceptIncludes(signals, ['rice', 'corn', 'cinnamon', 'grain']))) {
    return 'water, milk or plant milk, or a tiny rice/oat/corn-starch slurry with cinnamon and sugar, served cold over ice or warm as remembered';
  }
  if (role === 'beverage' && signalIncludes(signals, 'tea|chai|coffee|espresso|mate|cocoa')) {
    return 'a half-cup water or milk/plant-milk infusion with the remembered tea, coffee, cocoa, or spice direction';
  }
  if (role === 'sauce' && signalIncludes(signals, 'orange|hot|pepper|chile|lime|vinegar|acid|sharp')) {
    return 'one spoon of lime or vinegar plus hot sauce/chile, mustard, paprika or turmeric, garlic, and cilantro or another green herb';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'peanut|jaggery|brittle|chikki')) {
    return 'one spoon of roasted peanuts or peanut butter with brown sugar, syrup, or jaggery-style caramel if available';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'coconut|cocada|bukayo')) {
    return 'one spoon of granulated sugar mixed with toasted coconut flakes or a safe toasted seed to test grainy crystal and aroma';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'grainy|crystalline|powdery|crumbly')) {
    return 'one spoon of granulated sugar or crushed sugar cube with a safe toasted seed, nut, or plain cracker crumb to test crystallization texture';
  }
  if (role === 'confectionery' && signalIncludes(signals, 'chewy|sticky|gummy|nougat|taffy|melcocha')) {
    return 'one spoon of sugar warmed slightly with a safe nut butter, tahini, or syrup to test sticky matrix and aroma';
  }
  return fallback;
}

function composedCarrierIngredient(signals: string): string {
  if (signalIncludes(signals, 'yuca|cassava|tapioca')) {
    return 'cassava-family carrier matching the remembered base: frozen yuca/cassava, canned yuca, tapioca-starch paste, or plantain crisped in oil';
  }
  if (signalIncludes(signals, 'acorn|jelly|gelled|slippery')) {
    return 'cool gel carrier matching the remembered texture: plain gelatin, agar, mung-bean jelly, or another safe neutral gel';
  }
  return 'cheap grocery-store carrier matching the remembered base: starch, bread, potato, rice, bean, noodle, or cooked vegetable';
}

function composedProteinIngredient(signals: string): string {
  if (signalIncludes(signals, 'fish|shark')) {
    return 'small piece of white fish, canned fish, or firm tofu pan-seared in oil';
  }
  return 'small amount of accessible protein, fat, dairy, mushroom, bean, or plant-based substitute if relevant';
}

function composedBalanceIngredient(signals: string): string {
  if (signalIncludes(signals, 'orange|hot|pepper|chile|lime|vinegar|acid|sharp|sauce')) {
    return 'sharp sauce proxy: lime or vinegar, hot sauce or chile, mustard, paprika or turmeric, garlic, salt, and cilantro or another green herb';
  }
  return 'acid/sweet/salt/fat adjustment';
}

function composedBiteSteps(signals: string): string[] {
  const steps = [
    'Prepare only the carrier and one small aroma/fat/protein element.',
    'Use browning, toasting, frying, warming, or chilling only if that process is part of the remembered texture/aroma.',
    'Add the researched spice/aromatic direction to the fat or protein so aroma compounds bloom.',
    'Taste one composed bite and ask which mechanism hits: aroma, Maillard browning, fat richness, starch texture, acid/sweet balance, or contrast.',
  ];
  if (signalIncludes(signals, 'fish|shark') && signalIncludes(signals, 'orange|hot|pepper|chile|lime|vinegar|acid|sharp|sauce')) {
    return [
      'Pan-sear only one small bite of white fish or the safest local protein substitute.',
      'Stir a teaspoon sauce from lime or vinegar, hot sauce/chile, mustard, paprika or turmeric, garlic, salt, and cilantro or another green herb.',
      'Taste the fish with one dot of sauce and judge the contrast: fried richness, sharp acid, chile heat, orange-color cue, and green-herb aroma.',
      'Change one variable at a time before chasing exact peppers, herbs, or restaurant-style sauce.',
    ];
  }
  if (signalIncludes(signals, 'yuca|cassava|tapioca')) {
    return [
      'Crisp one tiny bite of frozen yuca/cassava, canned yuca, tapioca-starch paste, or plantain in oil.',
      'Brown one spoon of the filling/fat/protein cue separately so the aroma blooms.',
      'Taste them together and judge the cassava-family chew, crisp edge, and savory browned aroma.',
      'If the chew is wrong, fix the starch proxy before buying exact regional ingredients.',
    ];
  }
  return steps;
}

function isBeverageSignal(signals: string): boolean {
  return signalIncludes(signals, 'drink|beverage|soda|fizzy|carbonated|sparkling|seltzer|horchata|agua fresca|agua de cebada|ceba|atole|champurrado|lassi|chai|tea|coffee|espresso|cocoa|mate|milkshake|smoothie|tepache|sorrel|mauby|akasan|pinol|pinole|kombucha|over ice|foamy')
    || conceptIncludes(signals, ['beverage', 'barley', 'rice', 'cinnamon']);
}

function beverageCarrierIngredient(signals: string): string {
  if (signalIncludes(signals, 'fizzy|carbonated|sparkling|seltzer|soda')) {
    return 'chilled plain seltzer or sparkling water';
  }
  if (signalIncludes(signals, 'agua de cebada|cebada|ceba|barley')) {
    return 'barley water, toasted barley tea, or water with a tiny barley/oat/rice-starch slurry';
  }
  if (signalIncludes(signals, 'horchata|atole|champurrado|pinol|pinole') || conceptIncludes(signals, ['rice', 'cinnamon', 'corn', 'grain'])) {
    return 'water, milk or plant milk, or a tiny rice/oat/corn-starch slurry';
  }
  if (signalIncludes(signals, 'lassi|yogurt|dairy|milk|milkshake|smoothie')) {
    return 'milk, plant milk, yogurt-style base, or a small smoothie base if safe';
  }
  if (signalIncludes(signals, 'tea|chai|coffee|espresso|mate|cocoa')) {
    return 'water, milk, or plant milk for a half-cup steeped or brewed infusion';
  }
  return 'water, milk or plant milk, juice, or seltzer matching the remembered serving style';
}

function beverageAromaIngredient(signals: string): string {
  if (signalIncludes(signals, 'agua de cebada|cebada|ceba|barley')) {
    return 'toasted barley, barley tea, rice or oat starch aroma, lime zest, or a tiny citrus cue';
  }
  if (signalIncludes(signals, 'horchata|atole|champurrado|pinol|pinole') || conceptIncludes(signals, ['rice', 'cinnamon', 'corn', 'grain'])) {
    return 'cinnamon, vanilla, cocoa, toasted rice, toasted corn, barley tea, lime zest, or a tiny cue matching the named grain or spice';
  }
  if (signalIncludes(signals, 'fizzy|carbonated|sparkling|seltzer|soda')) {
    return 'one fruit, kola, vanilla, citrus, or spice aroma from pantry syrup, extract, zest, or juice';
  }
  if (signalIncludes(signals, 'tea|chai|coffee|espresso|mate|cocoa')) {
    return 'the remembered tea, coffee, cocoa, or spice direction';
  }
  return 'a specific fruit, spice, herb, roast, floral-water, citrus, or serving-aroma cue identified from the memory';
}

function beverageTemperatureIngredient(signals: string): string {
  if (signalIncludes(signals, 'cold|ice|iced|fizzy|carbonated|sparkling|seltzer|soda|juice|agua fresca') || conceptIncludes(signals, ['cold'])) {
    return 'ice or a chilled glass';
  }
  if (signalIncludes(signals, 'warm|hot|atole|champurrado|chai|tea|coffee|cocoa|mate')) {
    return 'a warm cup';
  }
  return 'ice or gentle warmth, matching the remembered serving temperature';
}

function beverageCueProfile(signals: string, userLocation?: string, overallConfidence?: Confidence): FoodScienceCueProfile {
  const carbonated = signalIncludes(signals, 'fizzy|carbonated|sparkling|seltzer|soda');
  const grainDrink = signalIncludes(signals, 'horchata|agua de cebada|ceba|atole|champurrado|pinol|pinole') || conceptIncludes(signals, ['rice', 'barley', 'corn', 'cinnamon', 'grain']);
  return {
    title: 'Minimum viable beverage-memory cue',
    goal: 'Test the memory as a drink by isolating sip temperature, dilution, body, sweetness, acid, aroma extraction, and serving ritual before buying or making the exact beverage.',
    effortMinutes: carbonated ? 8 : 12,
    format: 'sip',
    ingredients: [
      { item: beverageCarrierIngredient(signals), amount: '1/2 cup', purpose: carbonated ? 'tests carbonation or liquid base without buying the exact drink' : 'tests beverage body, dilution, and liquid base' },
      { item: beverageAromaIngredient(signals), amount: 'pinch, drop, tea bag, small spoon, or tiny piece', purpose: grainDrink ? 'tests cinnamon/spice extraction and grain-drink aroma' : 'tests the dominant beverage aroma without committing to the full recipe or drink' },
      { item: 'sugar, syrup, honey, or another safe sweetener', amount: 'pinch to 1 teaspoon', purpose: 'tests sweetness level and syrupy body', optional: true },
      { item: 'citrus juice, mild vinegar, yogurt tang, or other safe acid cue', amount: 'drop or tiny spoon', purpose: 'tests tartness, fermentation, or brightness', optional: true },
      { item: beverageTemperatureIngredient(signals), amount: 'as needed', purpose: 'tests temperature, dilution, and serving ritual', optional: true },
    ],
    steps: [
      'Do not buy the exact drink for the first test; build a half-cup local sip instead.',
      carbonated
        ? 'Start with chilled seltzer so carbonation and fizz are tested separately from syrup aroma.'
        : 'Start with the remembered liquid base and keep the portion small enough to adjust one variable at a time.',
      'Steep, stir, or dissolve the aroma cue just long enough to test extraction strength, then smell before sipping.',
      'Adjust sweetness, acid, salt if relevant, and dilution in tiny increments; temperature and ice can change the memory as much as flavor.',
      'Sip once and record whether body, aroma, carbonation, tartness, sweetness, temperature, or serving ritual carried the memory.',
    ],
    preserves: ['sip ritual', 'serving temperature', 'dilution/body', 'aroma extraction', carbonated ? 'carbonation bite' : 'sweetness/acid balance'],
    doesNotPreserve: ['exact bottled brand', 'full batch recipe', 'specialty beverage mix', 'complete regional method'],
    accessibilityPrinciples: ['test one half-cup sip', 'use pantry liquids, seltzer, spices, sweetener, citrus, or dairy/plant milk first', 'avoid buying rare drink mixes until the sip mechanism works', 'change only one variable at a time'],
    substituteLogic: [
      'Beverages are extraction and dilution systems: steeping, stirring, chilling, carbonation, and sweetness can carry the nostalgia as strongly as ingredients.',
      'Temperature and ice change aroma release, sweetness perception, and body, so they need to be tested directly.',
      'Carbonated memories should separate fizz from syrup; grain or dairy drinks should separate body from spice aroma and sweetness.',
    ],
    whyThisIsMinimum: 'A half-cup sip tests the beverage mechanisms that matter most (extraction, body, sweetness, acid, carbonation, dilution, and temperature) before shopping for the exact drink.',
    safetyNotes: ['Use only known edible ingredients.', 'Avoid allergens and alcohol unless explicitly intended and safe.', 'Keep caffeine, sugar, acid, and carbonation amounts small.'],
    followUpIfItWorks: ['Ask whether the original was cold, warm, iced, foamy, carbonated, thick, thin, strained, or served in a specific cup.', 'Ask whether the body came from grain starch, dairy, fruit pulp, syrup, carbonation, or fermentation.', 'Use source_ingredients to help find the exact beverage components near the user only after the sip mechanism works.'],
    components: decomposeIntoComponents(signals, userLocation, overallConfidence),
  };
}

function isSourHerbSoupSignal(signals: string): boolean {
  return signalIncludes(signals, 'soup|broth|sip|warm')
    && signalIncludes(signals, 'sour|tangy|acid|vinegar|pickle|brine|fermented|fermentation')
    && signalIncludes(signals, 'dill|sorrel|herb|pickle|potato|egg|pale|chunks');
}

function isCassavaFritterSignal(signals: string): boolean {
  const hasCassavaFamily = signalIncludes(signals, 'yuca|cassava|tapioca|plantain');
  const hasFriedTexture = signalIncludes(signals, 'fried|crispy|crunchy|golden|crisp');
  const hasRollOrFritterShape = signalIncludes(signals, 'roll|fritter|stuffed|filled|shape|oval|picadillo');
  return hasCassavaFamily && hasFriedTexture && hasRollOrFritterShape;
}

function cassavaFritterCueProfile(signals: string, userLocation?: string, overallConfidence?: Confidence): FoodScienceCueProfile {
  const hasMeatFilling = signalIncludes(signals, 'meat|beef|pork|chicken|picadillo|filling|stuffed|ground');
  const hasSofritoAroma = signalIncludes(signals, 'garlic|onion|cumin|achiote|oregano|tomato|culantro|sofrito');
  return {
    title: 'Minimum viable cassava-family fritter cue',
    goal: 'Test whether the memory is carried by crispy fried starch outside, chewy cassava inside, or browned savory filling aroma before naming a specific fritter.',
    effortMinutes: 12,
    format: 'bite',
    ingredients: [
      { item: 'frozen yuca, cassava, or green plantain from an ordinary grocery store', amount: 'one small piece', purpose: 'tests the gelatinized chewy starch and crisp fried surface without making dough from scratch' },
      { item: hasMeatFilling ? 'tiny piece of pan-seared ground meat or safe protein with a pinch of garlic, cumin, or oregano' : 'safe local protein or fat for Maillard aroma: pan-seared ground meat, browned tofu, or a drop of achiote oil if available', amount: '1 teaspoon', purpose: 'tests whether the memory trigger is the browned savory filling or just the fried starch' },
      { item: 'neutral oil for pan-frying', amount: 'thin film in a small pan', purpose: 'creates the crispy fried surface contrast' },
      { item: hasSofritoAroma ? 'pantry sofrito direction: tiny bit of tomato paste, garlic powder, or dried oregano' : 'pantry aromatic pinch: garlic powder, cumin, or dried herb', amount: 'pinch', purpose: 'tests whether the aroma memory is in the filling spice mix or the starch itself', optional: true },
    ],
    steps: [
      'Do not buy the exact suspected fritter for the first test; build one tiny local proxy instead.',
      'Boil the frozen yuca/cassava/plantain until tender, then mash or press flat.',
      'Pan-fry one small piece in a thin film of oil until golden and crisp on the outside.',
      'Taste the crispy outside and chewy inside first, without any filling.',
      'If the starch texture is right, add a tiny piece of browned protein or aromatic pinch to test whether the memory is the filling aroma or just the fried cassava.',
    ],
    preserves: ['crispy fried starch surface', 'chewy cassava-family interior', 'browned savory filling aroma', 'Maillard crust from pan-frying'],
    doesNotPreserve: ['exact regional name', 'precise dough recipe', 'specific filling proportions', 'original cooking vessel'],
    accessibilityPrinciples: ['use frozen yuca, cassava, or plantain from an ordinary grocery store', 'test one tiny piece', 'do not buy the exact suspected fritter until the texture direction works', 'pan-fry in a small skillet, not a deep fryer'],
    substituteLogic: [
      'Cassava-fritter nostalgia splits into three mechanisms: crispy fried surface, chewy gelatinized starch interior, and browned savory filling aroma.',
      'Frozen yuca or plantain tests the starch texture without grating and shaping raw cassava.',
      'A tiny piece of pan-seared protein with garlic or cumin tests whether the memory is the filling or just the fried starch.',
    ],
    whyThisIsMinimum: 'One small piece of boiled-then-fried frozen yuca or plantain tests the core crispy/chewy starch mechanism before grating cassava, making dough, or stuffing a full batch.',
    safetyNotes: ['Check for meat or herb allergies before testing.', 'Pan-fry with care; hot oil can splatter.'],
    followUpIfItWorks: ['Ask whether the original was stuffed with meat, cheese, or plain.', 'Ask whether the crust was thicker or thinner than the test piece.', 'Ask what aroma comes first: fried starch, garlic, cumin, tomato, or something else.', 'Only then use source_ingredients to help find regional fritter ingredients near the user.'],
    components: decomposeIntoComponents(signals, userLocation, overallConfidence),
  };
}

function sourHerbSoupCueProfile(signals: string, userLocation?: string, overallConfidence?: Confidence): FoodScienceCueProfile {
  const hasDill = signalIncludes(signals, 'dill');
  const acidCue = signalIncludes(signals, 'pickle|brine|fermented|fermentation')
    ? 'pickle brine, sauerkraut brine, or mild vinegar diluted heavily in warm water or broth'
    : 'mild vinegar, lemon, yogurt tang, or another safe sour cue diluted heavily in warm water or broth';
  const bodyCue = signalIncludes(signals, 'egg')
    ? 'a tiny piece of cooked egg or potato for pale body'
    : 'a tiny piece of potato, rice, or cooked egg for pale starch/body';
  return {
    title: 'Minimum viable sour-herb soup cue',
    goal: 'Test sourness source, dill or green-herb aroma, warm liquid body, and pale starch or egg texture before naming a specific soup.',
    effortMinutes: 10,
    format: 'sip',
    ingredients: [
      { item: 'warm water or light broth', amount: '1/4 cup', purpose: 'tests warm soup aroma release and body without making a pot' },
      { item: hasDill ? 'fresh or dried dill' : 'dill, parsley, sorrel-like greens, or the remembered herb if safe', amount: 'pinch', purpose: 'tests the herb aroma that distinguishes sour dill, pickle, sorrel, and other sour-herb soup families' },
      { item: acidCue, amount: 'drop to 1/4 teaspoon', purpose: 'tests whether the sourness is brine-like, vinegar-like, creamy-tangy, citrusy, or fermented' },
      { item: bodyCue, amount: 'one tiny piece', purpose: 'tests the pale chunk, starch body, or egg-body memory without committing to the exact soup', optional: true },
    ],
    steps: [
      'Warm only a tiny sip, not a full pot.',
      'Smell the dill or herb over the warm liquid before adding more acid.',
      'Add the sour cue in drops so brine, vinegar, dairy tang, or citrus does not overwhelm the herb.',
      'Taste one sip with the pale potato, rice, or egg body if that texture is remembered.',
      'If the herb is right but the sourness is wrong, change only the acid family before chasing a named soup.',
    ],
    preserves: ['dill or herb aroma', 'warm soup ritual', 'brine or fermented sourness', 'pale starch or egg body'],
    doesNotPreserve: ['exact Polish, Ukrainian, Czech, or family-specific soup identity', 'long-cooked broth', 'full garnish set', 'complete recipe'],
    accessibilityPrinciples: ['test one tiny warm sip', 'use pantry vinegar, pickle brine, lemon, yogurt tang, dill, potato, rice, or egg first', 'do not buy specialty sour soup ingredients until sourness and herb direction work'],
    substituteLogic: [
      'Sour-herb soups split into mechanisms: herb aroma, acid source, warm liquid body, and pale starch or egg texture.',
      'Pickle brine, vinegar, dairy tang, citrus, and fermentation read differently; testing them separately prevents generic sour soup drift.',
      'Potato, rice, or egg can test pale body without claiming a specific regional soup.',
    ],
    whyThisIsMinimum: 'A tiny warm sip tests the sour-herb mechanisms most likely to carry the memory: dill/herb aroma, brine-like acid, warm body, and pale chunk texture.',
    safetyNotes: ['Use only known edible herbs and acids.', 'Keep acid and salt tiny while testing.'],
    followUpIfItWorks: ['Ask whether the sourness was pickle brine, dairy tang, citrus, vinegar, or fermentation.', 'Ask whether the pale chunks were potato, egg, flour dumpling, rice, or something else.', 'Ask which family region or language word comes to mind.'],
    components: decomposeIntoComponents(signals, userLocation, overallConfidence),
  };
}

function foodScienceCueProfile(signals: string, userLocation?: string, overallConfidence?: Confidence, forceProbe?: boolean): FoodScienceCueProfile {
  if (forceProbe) {
    return {
      title: 'Minimum viable memory-probe cue',
      goal: 'Gather one more sensory datapoint before pretending to reconstruct a dish.',
      effortMinutes: 5,
      format: 'ritual',
      ingredients: [
        { item: 'no specialty ingredient yet', amount: 'none', purpose: 'avoid false certainty and wasted shopping' },
        { item: 'one safe remembered ingredient only if the user already has it', amount: 'tiny amount', purpose: 'optional sensory probe', optional: true },
      ],
      steps: [
        'Ask the user for one concrete sensory detail: smell, texture, sauce, temperature, spice/heat, acid/sweetness, or serving format.',
        'If they have a safe remembered ingredient already, smell or taste a tiny amount on a neutral carrier.',
        'Use that reaction to choose a bite, sip, sauce, or aroma cue next.',
      ],
      preserves: ['uncertainty', 'user memory as evidence', 'low-cost next step'],
      doesNotPreserve: ['dish identity', 'recipe structure', 'source specificity'],
      accessibilityPrinciples: ['buy nothing yet', 'ask for the highest-value missing sensory detail', 'only test safe ingredients already available'],
      substituteLogic: [
        'Without a sensory mechanism, any ingredient purchase is guesswork.',
        'The next useful proxy depends on whether the memory is carried by aroma, texture, sauce, fat, acid, sweetness, or ritual.',
      ],
      whyThisIsMinimum: 'The cheapest correct move is not a recipe; it is one more sensory clue that determines what kind of cue to test.',
      safetyNotes: ['Do not taste unknown ingredients.', 'Avoid allergens.'],
      followUpIfItWorks: ['Use the new sensory clue to build a focused bite, sip, sauce, or aroma cue.', 'Once a cue works, use source_ingredients to help the user find items near where they live.'],
      components: decomposeIntoComponents(signals, userLocation, overallConfidence),
    };
  }
  const hasProteinOrFat = signalIncludes(signals, 'meat|sausage|fish|shark|beef|pork|chicken|lamb|cheese|fat|butter|oil|fried|mushroom');
  const hasStarchOrBase = signalIncludes(signals, 'starch|rice|potato|potatoes|mash|masa|dough|bread|yuca|cassava|plantain|dumpling|noodle|bean|beans|acorn|jelly');
  const hasSauceOrCondiment = signalIncludes(signals, 'sauce|gravy|relish|chutney|salsa|condiment|dip|orange|creamy|soy|vinegar');
  const hasBeverage = isBeverageSignal(signals);
  const hasLiquid = signalIncludes(signals, 'soup|stew|broth|sip|porridge');
  const hasAroma = signalIncludes(signals, 'aroma|smell|spice|spiced|seasoned|garlic|onion|herb|pepper|cumin|coriander|clove|nutmeg|cinnamon|oregano|sesame|nutty');
  const hasTextureContrast = signalIncludes(signals, 'crispy|crunchy|chewy|creamy|soft|tender|stretchy|crisp|fried|grilled|charred|brown|golden|slippery|gelled|jelly|layered');
  const hasAcidOrSweet = signalIncludes(signals, 'sour|tangy|acid|vinegar|citrus|lime|lemon|fermented|sweet|syrup|molasses|sugar');
  const confectionerySignals = signals.replace(/\b(?:not|rather than|instead of)\s+(?:a |an )?(?:candy|dessert|confection(?:ery)?|cookie|biscuit|sweet(?:ness)?|sweet-texture)(?:\s+or\s+(?:a |an )?(?:candy|dessert|confection(?:ery)?|cookie|biscuit|sweet(?:ness)?|sweet-texture))*\b/gi, '');
  const hasStrongConfectionery = hasAnySignal(confectionerySignals, [wordSignal('caramel|dulce de leche|manjar|fudge|barfi|halva|baklava|mochi|candy|dessert|confection|cookie|biscuit|nougat|turrón|taffy|melcocha|cocada|flan|custard|pudding|chocolate|pastillas|milk candy|grainy/crystalline texture|powdery')]);
  const hasConfectionery = hasStrongConfectionery || hasAnySignal(confectionerySignals, [wordSignal('sweet|sugar')]);
  const hasSavoryCueFamily = hasProteinOrFat || hasSauceOrCondiment || (hasStarchOrBase && hasAroma) || signalIncludes(signals, 'savory|curry|gravy|spiced|seasoned|umami');

  if (hasBeverage && !hasProteinOrFat && !hasSauceOrCondiment && !signalIncludes(signals, 'not rice|not cinnamon|not horchata')) {
    return beverageCueProfile(signals, userLocation, overallConfidence);
  }

  if (isSourHerbSoupSignal(signals)) {
    return sourHerbSoupCueProfile(signals, userLocation, overallConfidence);
  }

  if (isCassavaFritterSignal(signals)) {
    return cassavaFritterCueProfile(signals, userLocation, overallConfidence);
  }

  if (hasConfectionery && (hasStrongConfectionery || !hasSavoryCueFamily)) {
    return {
      title: 'Minimum viable sweet-texture cue',
      goal: 'Test the memory by building a one-spoon local pantry proxy for sugar crystallization texture, toasted seed or coconut aroma, and crumbly or chewy mouthfeel before buying the suspected sweet. The first test should isolate whether the trigger is grainy sugar crystals, toasted aroma, sticky fat, or crumbly fracture.',
      effortMinutes: 8,
      format: 'bite',
      ingredients: [
        { item: signalIncludes(signals, 'peanut|jaggery|brittle|chikki') ? 'plain granulated or brown sugar, syrup, or jaggery-style sugar if already available' : 'plain granulated sugar or crushed sugar cube', amount: '1/2 teaspoon', purpose: 'tests crystalline sweetness, caramel direction, and powdery crumble without buying the suspected candy' },
        { item: signalIncludes(signals, 'peanut|jaggery|brittle|chikki') ? 'roasted peanuts, crushed peanut, or peanut butter if safe' : 'safe local aroma/texture cue such as toasted sesame seeds, coconut flakes, toasted oats, or crushed plain cracker', amount: '1/2 teaspoon', purpose: 'tests the remembered nut, seed, coconut, grain, or crumbly matrix aroma with ordinary local ingredients' },
        { item: 'tiny fat or binder if needed: butter, neutral oil, tahini, peanut butter, honey, or syrup only if safe and already available', amount: 'drop or smear', purpose: 'tests mouth-coating fat or sticky matrix without making a batch', optional: true },
        { item: 'pantry adjustment for flavor direction: cinnamon, vanilla extract, or pinch of salt', amount: 'pinch or drop', purpose: 'aroma and flavor tuning', optional: true },
        { item: 'warm water or black coffee as a palate cleanser', amount: 'sip', purpose: 'resets sweetness perception between tests', optional: true },
      ],
      steps: [
        'Do not buy the exact suspected candy for the first test; build one teaspoon of a local proxy instead.',
        'Put the sugar with the safe aroma/texture cue on a spoon or tiny neutral cracker and let it sit on the tongue before chewing.',
        signalIncludes(signals, 'peanut|jaggery|brittle|chikki')
          ? 'Notice whether the trigger is roasted peanut aroma, hard sugar snap or shatter, brown-sugar caramel, sticky fat, or sandy crumble.'
          : 'Notice whether the trigger is powdery sugar crystallization, toasted seed/coconut/grain aroma, sticky fat, or crumbly fracture.',
        'Change one local variable at a time: more sugar for powder, more toasted seed/coconut/oat for aroma, or a tiny fat/binder for mouthfeel.',
      ],
      preserves: ['sugar crystallization texture', 'toasted aroma direction', 'crumbly or sticky mouthfeel', 'spice aroma direction'],
      doesNotPreserve: ['exact regional recipe', 'specific cooking time', 'original wrapper or presentation', 'exact suspected candy'],
      accessibilityPrinciples: ['build the first test from local pantry or ordinary grocery ingredients', 'test one teaspoon', 'do not buy the exact suspected sweet until the mechanism works', 'avoid making a full batch until the texture direction is confirmed'],
      substituteLogic: [
        'Confectionery nostalgia is usually about sugar crystallization structure, aroma release, and mouth-coating fat or seed texture, not purchasing the exact candy.',
        'Granulated sugar tests powdery or crystalline texture; toasted seeds, coconut, oats, or plain cracker crumbs test the aroma and fracture pattern.',
        'A tiny pinch of cinnamon, vanilla, or salt can reveal whether the memory is about the base sweet, the toasted aroma, or the aromatic accent.',
      ],
      whyThisIsMinimum: 'One spoon of local pantry ingredients tests the core sugar-crystallization, aroma, and mouthfeel mechanisms before specialty shopping or cooking.',
      safetyNotes: ['Check for dairy or nut allergies before testing.', 'Keep pieces small; high-sugar foods can be intense.'],
      followUpIfItWorks: ['Ask whether the original was darker/caramelly or lighter/milky.', 'Ask whether it was grainy, creamy, sticky, or crumbly.', 'Ask what aroma comes to mind: toasted seed, vanilla, cinnamon, coconut, dairy, or something else.', 'Only then use source_ingredients to help find regional sweet ingredients near the user.'],
      components: decomposeIntoComponents(signals, userLocation, overallConfidence),
    };
  }

  if (hasLiquid) {
    return {
      title: 'Minimum viable aroma-sip cue',
      goal: 'Test the memory through a one-cup liquid carrier that can isolate aroma, salt, fat, acid, and body before making a full pot.',
      effortMinutes: 12,
      format: 'sip',
      ingredients: [
        { item: 'safe liquid from the remembered family: water for watery/cold clues, broth for savory soup clues, milk or plant milk only when body was remembered', amount: '1 cup', purpose: 'volatile aroma and taste carrier' },
        { item: 'one named aroma or balance cue from the memory, such as herb, spice, grain, citrus, roast, or sauce note', amount: 'pinch, drop, or tiny piece', purpose: 'primary smell/taste trigger' },
        { item: 'tiny fat source such as oil, butter, rendered fat, or coconut milk if relevant', amount: '1/4 to 1 teaspoon', purpose: 'carries fat-soluble aroma compounds', optional: true },
        { item: 'acid/sweet/salt adjustment from pantry ingredients', amount: 'drops or pinches', purpose: 'balance sourness, sweetness, salinity, and brightness', optional: true },
      ],
      steps: [
        'Warm the liquid carrier gently; do not build a full dish.',
        'Bloom the aromatic or spice cue briefly so volatile compounds reach the nose.',
        'Add fat only if the memory needs richness or lingering aroma; fat carries many aroma compounds.',
        'Adjust acid, sweetness, and salt one drop or pinch at a time, then sip once and stop.',
        'Record whether aroma, body, acidity, or seasoning carried the memory before escalating.',
      ],
      preserves: ['volatile aroma release', 'salt/acid/fat balance', 'warm sip ritual', 'body direction'],
      doesNotPreserve: ['long-cooked body', 'complete ingredient list', 'full texture', 'regional specificity'],
      accessibilityPrinciples: ['test in one cup', 'use pantry acid/salt/fat first', 'use the cheapest safe liquid carrier', 'avoid buying rare ingredients until the balance is directionally right'],
      substituteLogic: [
        'A liquid cue can test whether aroma, fat, acid, salt, and body are the real memory carriers.',
        'Fat-soluble aromas need a little fat; water alone may taste flat even if the spice is correct.',
        'Acid and salt change perception quickly, so they should be adjusted in drops/pinches rather than full-recipe amounts.',
      ],
      whyThisIsMinimum: 'A one-cup sip tests the chemistry of aroma release, body, acid, salt, and fat before wasting ingredients on a full pot.',
      safetyNotes: ['Use only known edible ingredients.', 'Keep tasting amounts small while adjusting salt, acid, or heat.'],
      followUpIfItWorks: ['Ask whether the liquid body came from grain starch, broth, dairy/plant milk, fruit pulp, fat, or dilution.', 'Ask whether the brightness came from citrus, vinegar, dairy, fermentation, or tomato.', 'Ask what texture or garnish is missing.', 'Use source_ingredients to help find key items near the user.'],
      components: decomposeIntoComponents(signals, userLocation, overallConfidence),
    };
  }

  if (hasProteinOrFat || hasStarchOrBase || hasTextureContrast) {
    return {
      title: 'Minimum viable composed-bite cue',
      goal: 'Test a tiny composed bite that isolates carrier, aroma/fat, texture, and balance without requiring exact specialty ingredients.',
      effortMinutes: 15,
      format: 'bite',
      ingredients: [
        { item: composedCarrierIngredient(signals), amount: '1-2 bites', purpose: 'texture and sauce carrier' },
        { item: composedProteinIngredient(signals), amount: '1-2 tablespoons', purpose: 'fat/protein/umami carrier' },
        { item: 'researched aromatic or spice direction using pantry spices/aromatics', amount: 'pinch to 1 teaspoon', purpose: 'volatile memory trigger', optional: true },
        { item: composedBalanceIngredient(signals), amount: 'drops, pinches, or 1 teaspoon', purpose: 'balance and mouthfeel control', optional: true },
      ],
      steps: composedBiteSteps(signals),
      preserves: ['carrier texture', 'fat/aroma delivery', 'one-bite ritual', 'core balance signal'],
      doesNotPreserve: ['exact specialty ingredient', 'full plating', 'full recipe process', 'family-specific proportions'],
      accessibilityPrinciples: ['use grocery-store carriers and proteins first', 'test in one or two bites', 'use pantry aromatics before specialty sourcing', 'buy exact items only after the mechanism works'],
      substituteLogic: [
        'Proteins and fats are carriers for Maillard notes and fat-soluble aromatics; a cheap carrier can test the same chemistry before sourcing the exact item.',
        'Starches and breads mainly control texture and sauce absorption, so a common starch can test whether the mouthfeel is central.',
        'Acid, sugar, and salt can move a bite toward the remembered balance without changing the whole dish.',
      ],
      whyThisIsMinimum: 'A composed bite tests the reusable food-science mechanisms (aroma, fat, browning, starch texture, and balance) before committing to specialty shopping or a full recipe.',
      safetyNotes: ['Cook proteins safely.', 'Avoid allergens and unknown ingredients.', 'Use high heat carefully if crisping or browning.'],
      followUpIfItWorks: ['Ask which part hit first: smell, texture, sauce, fat, spice, or sweetness/acidity.', 'Ask what still feels missing.', 'Use find_sensory_substitutes and source_ingredients to help the user find items near where they live now.'],
      components: decomposeIntoComponents(signals, userLocation, overallConfidence),
    };
  }

  if (hasSauceOrCondiment) {
    return {
      title: 'Minimum viable sauce-and-carrier cue',
      goal: 'Test whether the sauce/condiment contrast is carrying the memory using a tiny pantry sauce and a neutral carrier.',
      effortMinutes: 10,
      format: 'condiment',
      ingredients: [
        { item: 'neutral carrier such as bread, rice, potato, cracker, tortilla, or cooked starch', amount: '1-2 bites', purpose: 'bland base for judging sauce and texture' },
        { item: 'pantry sauce base matching the researched direction: tomato, dairy, oil, vinegar, fruit, chile, or stock', amount: '1 tablespoon', purpose: 'cheap proxy for the sauce family' },
        { item: 'aromatic/spice cue from researched facts', amount: 'pinch', purpose: 'volatile aroma trigger', optional: true },
        { item: 'acid, sugar, salt, or fat adjustment', amount: 'drops or pinches', purpose: 'balance and mouthfeel tuning', optional: true },
      ],
      steps: [
        'Make only one tablespoon of sauce proxy, not a batch.',
        'Tune it by food-science dimensions: fat for body, acid for brightness, sugar for roundness, salt for intensity, spice/aromatics for memory.',
        'Taste it on the neutral carrier so texture and sauce can be judged together.',
        'Change one variable at a time and note what suddenly feels familiar or wrong.',
      ],
      preserves: ['sauce contrast', 'carrier-plus-condiment ritual', 'fat/acid/sweet/salt balance', 'aroma impact'],
      doesNotPreserve: ['exact brand or restaurant sauce', 'complete dish structure', 'full garnish set'],
      accessibilityPrinciples: ['start from pantry sauce bases', 'test one tablespoon', 'use a neutral grocery-store carrier', 'adjust balance before sourcing specialty condiments'],
      substituteLogic: [
        'Sauces are often families of fat, water, acid, sugar, salt, heat, and aromatics; matching that balance can matter more than matching the name.',
        'A bland carrier exposes whether the sauce is the memory trigger or merely background.',
        'One-variable adjustments prevent a generic sauce from becoming a confused full recipe.',
      ],
      whyThisIsMinimum: 'A tablespoon of sauce on a neutral carrier tests the contrast and balance that often carries the nostalgic bite.',
      safetyNotes: ['Check condiment allergens and chile heat.', 'Do not mix unknown fermented or wild ingredients.'],
      followUpIfItWorks: ['Ask whether the sauce was smooth or chunky.', 'Ask whether it leaned fatty, acidic, sweet, spicy, or savory.', 'Ask what carrier it was served on.', 'Use source_ingredients to help the user find sauce components near where they live.'],
      components: decomposeIntoComponents(signals, userLocation, overallConfidence),
    };
  }

  if (hasAroma || hasAcidOrSweet) {
    return {
      title: 'Minimum viable aroma-balance cue',
      goal: 'Test the likely memory through smell and taste balance before picking a full dish format.',
      effortMinutes: 8,
      format: 'aroma-cue',
      ingredients: [
        { item: 'safe pantry aromatic, spice, herb, fat, acid, or sweetener matching the researched clue', amount: 'pinch, drop, or tiny piece', purpose: 'single sensory variable' },
        { item: 'neutral carrier such as oil, water, bread, rice, or potato', amount: 'small amount', purpose: 'makes the cue smellable or tasteable', optional: true },
      ],
      steps: [
        'Warm, dilute, or taste only the single strongest sensory clue.',
        'Smell first, then taste a tiny amount on a neutral carrier if safe.',
        'Do not add a second variable until the first one is judged familiar or wrong.',
      ],
      preserves: ['single aroma or balance cue', 'low-cost sensory testing', 'user reaction as evidence'],
      doesNotPreserve: ['dish identity', 'full texture', 'complete recipe'],
      accessibilityPrinciples: ['test one pantry variable', 'spend almost nothing', 'avoid specialty shopping until a cue works'],
      substituteLogic: [
        'When identity is uncertain, isolating one aroma or balance dimension gives cleaner evidence than cooking a full dish.',
        'Neutral carriers prevent strong ingredients from being mistaken for complete recipes.',
      ],
      whyThisIsMinimum: 'One sensory variable is the cheapest way to learn whether the reconstruction is moving toward or away from the memory.',
      safetyNotes: ['Use only safe edible ingredients.', 'Do not taste unidentified wild plants or unknown powders.'],
      followUpIfItWorks: ['Ask what dish format carried that aroma or balance.', 'Ask what texture or sauce belonged with it.', 'Use find_sensory_substitutes to find accessible alternatives near the user.'],
      components: decomposeIntoComponents(signals, userLocation, overallConfidence),
    };
  }

  return {
    title: 'Minimum viable memory-probe cue',
    goal: 'Gather one more sensory datapoint before pretending to reconstruct a dish.',
    effortMinutes: 5,
    format: 'ritual',
    ingredients: [
      { item: 'no specialty ingredient yet', amount: 'none', purpose: 'avoid false certainty and wasted shopping' },
      { item: 'one safe remembered ingredient only if the user already has it', amount: 'tiny amount', purpose: 'optional sensory probe', optional: true },
    ],
    steps: [
      'Ask the user for one concrete sensory detail: smell, texture, sauce, temperature, spice/heat, acid/sweetness, or serving format.',
      'If they have a safe remembered ingredient already, smell or taste a tiny amount on a neutral carrier.',
      'Use that reaction to choose a bite, sip, sauce, or aroma cue next.',
    ],
    preserves: ['uncertainty', 'user memory as evidence', 'low-cost next step'],
    doesNotPreserve: ['dish identity', 'recipe structure', 'source specificity'],
    accessibilityPrinciples: ['buy nothing yet', 'ask for the highest-value missing sensory detail', 'only test safe ingredients already available'],
    substituteLogic: [
      'Without a sensory mechanism, any ingredient purchase is guesswork.',
      'The next useful proxy depends on whether the memory is carried by aroma, texture, sauce, fat, acid, sweetness, or ritual.',
    ],
    whyThisIsMinimum: 'The cheapest correct move is not a recipe; it is one more sensory clue that determines what kind of cue to test.',
    safetyNotes: ['Do not taste unknown ingredients.', 'Avoid allergens.'],
    followUpIfItWorks: ['Use the new sensory clue to build a focused bite, sip, sauce, or aroma cue.', 'Once a cue works, use source_ingredients to help the user find items near where they live.'],
    components: decomposeIntoComponents(signals, userLocation, overallConfidence),
  };
}

export function generateMinimumViableNostalgiaCue(input: MinimumViableNostalgiaInput): MinimumViableNostalgiaCue {
  const signals = textSignals(input);
  const effort = input.maxEffortMinutes;
  const maxEffort = Number.isFinite(effort) ? Math.max(1, effort!) : 20;
  const confidence = input.researchFindings?.confidence ?? input.dossier.confidence;

  // Be conservative: if we have almost no information, ask questions instead of prescribing a test.
  const wordCount = (arr: string[]) => arr.join(' ').trim().split(/\s+/).filter(Boolean).length;
  const totalWords = wordCount(input.dossier.evidenceLedger.userSaid)
    + wordCount(input.dossier.evidenceLedger.researched)
    + wordCount(input.dossier.evidenceLedger.inferred);

  // A "concrete dish" is one we actually identified, not a generic descriptive fallback.
  const isGenericFallback = (name: string) =>
    name.startsWith('Unidentified ') ||
    name === 'unknown food memory';
  const hasConcreteDish = input.dossier.hypotheses.some(
    (h) => h.confidence !== 'Low' && !isGenericFallback(h.name),
  );

  // Only force a memory-probe when there are literally no food-related signals at all.
  // We check whether the signals match any component role (protein, starch, sauce, etc.).
  const components = decomposeIntoComponents(signals, input.userLocation, confidence);
  const hasAnyFoodClue = components.length > 1 || components[0].role !== 'overall';

  // Force the memory-probe cue only when information is truly too sparse to justify any test.
  // totalWords < 5 catches "I remember food"-level vagueness; hasAnyFoodClue catches ingredient-only inputs like "chicken".
  const forceProbe = confidence === 'Low' && !hasConcreteDish && !hasAnyFoodClue && totalWords < 5;

  const engine = runCueProfileEngine({
    signals,
    userLocation: input.userLocation,
    confidence,
    forceProbe,
    buildProfile: foodScienceCueProfile,
    decomposeComponents: decomposeIntoComponents,
  });
  const constrainedCue = adaptCueProfileForConstraints(engine.profile, input.constraints);
  const profile = constrainedCue.profile;
  const constraintGuidance = constrainedCue.guidance;

  return {
    ...profile,
    accessibilityPrinciples: unique([...profile.accessibilityPrinciples, ...constraintGuidance.accessibilityPrinciples]),
    substituteLogic: unique([...profile.substituteLogic, ...constraintGuidance.substituteLogic]),
    safetyNotes: unique([...profile.safetyNotes, ...constraintGuidance.safetyNotes]),
    effortMinutes: Math.min(maxEffort, profile.effortMinutes),
    confidence: profile.title === 'Minimum viable memory-probe cue' ? 'Low' : confidence,
  };
}
