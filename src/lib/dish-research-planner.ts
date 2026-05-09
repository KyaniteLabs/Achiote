import dishFamiliesData from '../data/dish-families.json' with { type: 'json' };
import correctedResearchTargetsData from '../data/corrected-research-targets.json' with { type: 'json' };
import memoryHintsData from '../data/memory-hints.json' with { type: 'json' };
import type {
  CollectedFoodMemory,
  Confidence,
  DishHypothesis,
  DishResearchPlan,
} from './types.js';
import { unique, normalizeForLooseMatch, includesAny } from './food-memory-text.js';
import { isBroadRegionalHint } from './food-memory-collector.js';

const REGION_TO_FAMILY_MAP: Record<string, string[]> = memoryHintsData.regionFamilyMap;

function familyRegionsForDetected(detectedRegions: string[]): string[] {
  return unique(detectedRegions.flatMap((r) => REGION_TO_FAMILY_MAP[r] ?? []));
}

function dataDrivenHypotheses(memory: CollectedFoodMemory): DishHypothesis[] {
  const { possibleDishNames, culturalOrRegionalHints } = memory.extractedClues;
  if (possibleDishNames.length === 0) return [];

  const allHypotheses: DishHypothesis[] = [];

  for (const family of dishFamiliesData.families) {
    const matchedVariants = (family.variants ?? []).filter((variant) => {
      const nameMatch = possibleDishNames.some((name) =>
        variant.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase()),
      ) || variant.aliases.some((alias) =>
        memory.normalizedMemory.toLowerCase().includes(alias.toLowerCase()),
      );
      if (!nameMatch) return false;
      return variant.regions.some((r) => culturalOrRegionalHints.some((hint) => {
        const mapped = REGION_TO_FAMILY_MAP[hint] ?? [];
        return mapped.some((mr) => r === mr) || r === hint;
      }));
    });

    if (matchedVariants.length === 0) continue;

    const allVariants = family.variants ?? [];

    for (const variant of allVariants) {
      const isDirectMatch = matchedVariants.includes(variant);
      const whyPossible: string[] = [];
      if (isDirectMatch) {
        whyPossible.push('phonetic overlap with the remembered fragment');
      } else {
        whyPossible.push('similar dish from the same family');
      }
      if (culturalOrRegionalHints.length > 0) whyPossible.push(`${culturalOrRegionalHints[0]} family context`);
      if (memory.extractedClues.occasions.length > 0) whyPossible.push('often family/holiday associated');

      allHypotheses.push({
        name: variant.name,
        whyPossible,
        whatWouldConfirm: variant.distinguishingElements,
        confidence: isDirectMatch ? 'Medium' : 'Low',
        researchRequired: true,
      });
    }
  }

  return allHypotheses.slice(0, 5);
}

// Ingredient + region + sensory → specific dish inference for when no name was given
const INFERRED_DISH_PATTERNS: Array<{
  regions: string[];
  ingredients: string[];
  sensory: string[];
  dish: string;
  why: string;
  confidence: Confidence;
}> = [
  { regions: ['poland', 'eastern europe', 'europe'], ingredients: ['dill', 'potato'], sensory: ['sour', 'soup'], dish: 'Zupa Ogórkowa', why: 'Polish dill pickle soup with potatoes and fermented brine sourness', confidence: 'Medium' },
  { regions: ['ukraine', 'russia', 'eastern europe', 'europe'], ingredients: ['dill', 'egg'], sensory: ['sour', 'soup'], dish: 'Sorrel Soup (Shchavelya Sup)', why: 'Ukrainian/Russian sour soup with sorrel leaves, egg, and dill', confidence: 'Medium' },
  { regions: ['czech', 'slovakia', 'eastern europe', 'europe'], ingredients: ['dill', 'potato'], sensory: ['sour', 'soup'], dish: 'Kulajda', why: 'Czech sour mushroom-dill soup with potatoes and sour cream', confidence: 'Medium' },
  { regions: ['poland', 'eastern europe', 'europe'], ingredients: ['rye', 'sausage'], sensory: ['sour', 'soup'], dish: 'Żurek', why: 'Polish rye sour soup with sausage and potatoes', confidence: 'Medium' },
  { regions: ['russia', 'ukraine', 'eastern europe', 'europe'], ingredients: ['cabbage'], sensory: ['sour', 'soup'], dish: 'Shchi', why: 'Russian sour cabbage soup', confidence: 'Medium' },
  { regions: ['mexico', 'latin america'], ingredients: ['pork', 'tomatillo'], sensory: ['sour', 'soup'], dish: 'Pozole Verde', why: 'Mexican hominy stew with tomatillo and pork', confidence: 'Medium' },
  { regions: ['mexico', 'latin america'], ingredients: ['tortilla', 'chicken'], sensory: ['soup'], dish: 'Sopa de Tortilla', why: 'Mexican tortilla soup with chile and chicken', confidence: 'Medium' },
  { regions: ['thailand', 'southeast asia'], ingredients: ['lemongrass', 'lime', 'chile'], sensory: ['sour', 'spicy', 'soup'], dish: 'Tom Yum', why: 'Thai hot and sour soup with lemongrass, lime, and chile', confidence: 'High' },
  { regions: ['philippines', 'southeast asia'], ingredients: ['tamarind', 'pork', 'fish'], sensory: ['sour', 'soup'], dish: 'Sinigang', why: 'Filipino sour soup with tamarind and meat or fish', confidence: 'High' },
  { regions: ['vietnam', 'southeast asia'], ingredients: ['tamarind', 'pineapple', 'tomato'], sensory: ['sour', 'soup', 'fish'], dish: 'Canh Chua', why: 'Vietnamese sour fish soup with tamarind and pineapple', confidence: 'High' },
  { regions: ['china', 'east asia'], ingredients: ['vinegar', 'pepper', 'tofu'], sensory: ['sour', 'spicy', 'soup'], dish: 'Hot and Sour Soup (Suan La Tang)', why: 'Chinese soup with vinegar, pepper, and tofu', confidence: 'High' },
  { regions: ['india', 'south asia'], ingredients: ['lentil', 'tamarind'], sensory: ['sour', 'soup'], dish: 'Rasam', why: 'South Indian sour lentil soup with tamarind and spices', confidence: 'Medium' },
  { regions: ['germany', 'central europe', 'europe'], ingredients: ['cabbage', 'sausage'], sensory: ['sour', 'soup'], dish: 'Sauerkrautsuppe', why: 'German sour cabbage soup with sausage', confidence: 'Medium' },
  { regions: ['greece', 'mediterranean', 'europe'], ingredients: ['egg', 'lemon'], sensory: ['sour', 'soup'], dish: 'Avgolemono', why: 'Greek egg-lemon soup with rice or orzo', confidence: 'High' },
  { regions: ['turkey', 'middle east'], ingredients: ['yogurt', 'mint'], sensory: ['sour', 'soup'], dish: 'Yayla Çorbası', why: 'Turkish yogurt soup with mint and rice', confidence: 'Medium' },
  { regions: ['iran', 'middle east'], ingredients: ['pomegranate', 'herb'], sensory: ['sour', 'soup'], dish: 'Ash-e Anar', why: 'Iranian pomegranate soup with herbs and meatballs', confidence: 'Medium' },
  { regions: ['japan', 'east asia'], ingredients: ['miso', 'tofu', 'seaweed'], sensory: ['soup'], dish: 'Miso Soup', why: 'Japanese fermented soybean paste soup', confidence: 'High' },
  { regions: ['korea', 'east asia'], ingredients: ['soybean paste', 'tofu'], sensory: ['soup'], dish: 'Doenjang Guk', why: 'Korean fermented soybean paste soup', confidence: 'High' },
  // Central American / Panamanian confectionery
  { regions: ['panama', 'central america', 'latin america', 'colombia'], ingredients: ['milk', 'sugar', 'caramel'], sensory: ['sweet', 'soft texture', 'grainy/crystalline texture'], dish: 'Dulce de Leche en Tabla (Manjar Blanco)', why: 'Slow-cooked milk candy cut into rectangles, grainy from lactose crystallization, wrapped in paper', confidence: 'High' },
  { regions: ['panama', 'central america', 'latin america', 'mexico'], ingredients: ['milk', 'sugar'], sensory: ['sweet', 'soft texture'], dish: 'Leche Quemada', why: 'Burnt milk fudge with grainy texture, common in Central America', confidence: 'Medium' },
  { regions: ['panama', 'central america', 'latin america', 'caribbean'], ingredients: ['coconut', 'sugar'], sensory: ['sweet'], dish: 'Cocada', why: 'Coconut candy made with sugar, common throughout Latin America and the Caribbean', confidence: 'Medium' },
  { regions: ['latin america', 'caribbean', 'puerto rican', 'cuban', 'dominican'], ingredients: ['rice', 'coconut', 'milk', 'cinnamon'], sensory: ['sweet'], dish: 'Arroz con Dulce', why: 'Caribbean/Latin American rice pudding with coconut milk and cinnamon', confidence: 'High' },
  { regions: ['latin america', 'mexico', 'central america', 'spain'], ingredients: ['egg', 'milk', 'caramel'], sensory: ['sweet', 'custard/pudding'], dish: 'Flan (Crème Caramel)', why: 'Caramel custard ubiquitous in Latin America', confidence: 'High' },
  { regions: ['argentina', 'uruguay', 'latin america'], ingredients: ['caramel', 'cookie'], sensory: ['sweet'], dish: 'Alfajor', why: 'Dulce de leche sandwich cookie, very popular in Argentina and Uruguay', confidence: 'High' },
  { regions: ['mexico', 'latin america'], ingredients: ['masa', 'cinnamon', 'sugar'], sensory: ['sweet'], dish: 'Champurrado / Atole', why: 'Thick Mexican hot drink/porridge made with masa, chocolate or cinnamon, and sugar', confidence: 'Medium' },
  { regions: ['mexico', 'latin america'], ingredients: ['masa', 'cinnamon', 'sugar'], sensory: ['sweet'], dish: 'Tamales Dulces', why: 'Sweet tamales made with masa, sugar, cinnamon, raisins, or pineapple', confidence: 'Medium' },
  { regions: ['colombia', 'venezuela', 'latin america'], ingredients: ['corn', 'cheese'], sensory: ['sweet'], dish: 'Arepa de Maíz Dulce / Arepa de Anís', why: 'Sweet corn arepa, sometimes with anise or cheese', confidence: 'Medium' },
  { regions: ['latin america', 'caribbean'], ingredients: ['plantains', 'sugar'], sensory: ['sweet', 'soft texture'], dish: 'Plátano en Tentación / Plátano Maduro', why: 'Sweet caramelized ripe plantains, common throughout Latin America', confidence: 'High' },
  { regions: ['peru', 'bolivia', 'latin america'], ingredients: ['honey', 'nuts'], sensory: ['sweet'], dish: 'King Kong (Dulce de Leche and Honey Cookie)', why: 'Peruvian layered cookie with dulce de leche, honey, and nuts', confidence: 'Medium' },
  // Indian subcontinent confectionery
  { regions: ['india', 'south asia'], ingredients: ['milk', 'sugar'], sensory: ['sweet'], dish: 'Barfi / Pedha', why: 'Indian milk fudge made by reducing milk with sugar, often grainy', confidence: 'High' },
  { regions: ['india', 'south asia'], ingredients: ['coconut', 'sugar'], sensory: ['sweet'], dish: 'Nariyal Barfi / Coconut Ladoo', why: 'Indian coconut sweet made with condensed milk or sugar', confidence: 'High' },
  // Middle Eastern / Mediterranean confectionery
  { regions: ['middle east', 'turkey', 'greece', 'mediterranean'], ingredients: ['nuts', 'honey'], sensory: ['sweet'], dish: 'Baklava', why: 'Layered phyllo pastry with nuts and honey syrup', confidence: 'High' },
  { regions: ['middle east', 'turkey', 'mediterranean'], ingredients: ['sesame', 'honey'], sensory: ['sweet'], dish: 'Halva / Halwa', why: 'Sesame and honey confection with crumbly/grainy texture', confidence: 'High' },
  { regions: ['turkey', 'middle east'], ingredients: ['milk', 'sugar', 'flour'], sensory: ['sweet'], dish: 'Tavuk Göğsü / Kazandibi', why: 'Turkish milk pudding with caramelized bottom, sometimes chicken breast for texture', confidence: 'Medium' },
  // European confectionery
  { regions: ['france', 'europe'], ingredients: ['caramel', 'butter', 'sugar'], sensory: ['sweet', 'soft texture'], dish: 'Caramel au Beurre Salé / Salted Butter Caramel', why: 'French soft caramel candy, often wrapped individually', confidence: 'High' },
  { regions: ['scotland', 'uk', 'europe'], ingredients: ['sugar', 'butter'], sensory: ['sweet', 'grainy/crystalline texture'], dish: 'Tablet / Scottish Tablet', why: 'Scottish confection made from sugar, butter, and condensed milk with a grainy, melt-in-mouth texture', confidence: 'High' },
  { regions: ['england', 'uk', 'europe'], ingredients: ['sugar', 'butter'], sensory: ['sweet', 'soft texture'], dish: 'Fudge', why: 'British soft candy made from sugar, butter, and milk', confidence: 'High' },
  { regions: ['ireland', 'uk', 'europe'], ingredients: ['potato', 'sugar'], sensory: ['sweet'], dish: 'Potato Candy / Irish Potato Candy', why: 'Coconut cream candy rolled in cinnamon to look like potatoes', confidence: 'Medium' },
  { regions: ['usa', 'america', 'southern us'], ingredients: ['peanut', 'sugar'], sensory: ['sweet'], dish: 'Peanut Brittle / Peanut Butter Fudge', why: 'American confection with peanuts and caramelized sugar', confidence: 'Medium' },
  { regions: ['usa', 'america'], ingredients: ['marshmallow', 'chocolate'], sensory: ['sweet'], dish: "S'mores / Rocky Road Fudge", why: 'American marshmallow and chocolate confection', confidence: 'Medium' },
  // East Asian confectionery
  { regions: ['japan', 'east asia'], ingredients: ['rice', 'sugar'], sensory: ['sweet'], dish: 'Mochi / Daifuku', why: 'Japanese rice cake with sweet filling', confidence: 'High' },
  { regions: ['japan', 'east asia'], ingredients: ['bean', 'sugar'], sensory: ['sweet'], dish: 'Yokan / Anko (Red Bean Paste)', why: 'Japanese sweet bean jelly or paste', confidence: 'High' },
  { regions: ['china', 'east asia'], ingredients: ['rice', 'sugar'], sensory: ['sweet'], dish: 'Nian Gao (Rice Cake)', why: 'Chinese New Year sticky rice cake', confidence: 'High' },
  { regions: ['china', 'east asia'], ingredients: ['nuts', 'sugar'], sensory: ['sweet'], dish: 'Hùntáo Gāo (Walnut Cookie)', why: 'Chinese walnut shortbread cookie that crumbles in the mouth', confidence: 'Medium' },
  // Southeast Asian confectionery
  { regions: ['thailand', 'southeast asia'], ingredients: ['coconut', 'sugar', 'milk'], sensory: ['sweet'], dish: 'Khanom Krok / Coconut Pancake', why: 'Thai coconut griddle cake with sweet creamy center', confidence: 'Medium' },
  { regions: ['philippines', 'southeast asia'], ingredients: ['milk', 'sugar'], sensory: ['sweet'], dish: 'Pastillas de Leche', why: 'Filipino milk candy made from carabao milk and sugar, often wrapped in paper', confidence: 'High' },
  { regions: ['philippines', 'southeast asia'], ingredients: ['coconut', 'sugar'], sensory: ['sweet'], dish: 'Bukayo / Cocada Filipina', why: 'Filipino coconut candy made with caramelized sugar', confidence: 'Medium' },
  { regions: ['indonesia', 'malaysia', 'southeast asia'], ingredients: ['coconut', 'sugar', 'rice'], sensory: ['sweet'], dish: 'Klepon / Onde-Onde', why: 'Indonesian/Malaysian glutinous rice balls with palm sugar and coconut', confidence: 'High' },
  // African confectionery
  { regions: ['south africa'], ingredients: ['milk', 'sugar'], sensory: ['sweet'], dish: 'Fudge / Cape Malay Fudge', why: 'South African milk fudge with grainy texture', confidence: 'Medium' },
  { regions: ['nigeria', 'ghana', 'west africa'], ingredients: ['coconut', 'sugar'], sensory: ['sweet'], dish: 'Coconut Candy / Chin Chin', why: 'West African coconut toffee or fried sweet dough', confidence: 'Medium' },
];

function inferredHypotheses(memory: CollectedFoodMemory): DishHypothesis[] {
  const regions = memory.extractedClues.culturalOrRegionalHints.map((r) => r.toLowerCase());
  const ingredients = memory.extractedClues.rememberedIngredients.map((i) => i.toLowerCase());
  const sensory = memory.extractedClues.sensoryClues.map((s) => s.toLowerCase());
  const text = memory.normalizedMemory.toLowerCase();

  const matches = INFERRED_DISH_PATTERNS.filter((pattern) => {
    const regionMatch = pattern.regions.some((r) => regions.some((region) => region.includes(r) || r.includes(region)));
    const ingredientMatch = pattern.ingredients.some((i) => ingredients.some((ing) => ing.includes(i) || i.includes(ing)) || text.includes(i));
    const sensoryMatch = pattern.sensory.some((s) => sensory.some((sen) => sen.includes(s) || s.includes(sen)) || text.includes(s));
    return regionMatch && ingredientMatch && sensoryMatch;
  });

  return matches.map((match) => ({
    name: match.dish,
    whyPossible: [match.why, 'inferred from ingredient, region, and sensory clues'],
    whatWouldConfirm: ['original language spelling', 'region/town', 'ingredients', 'cooking method', 'occasion'],
    confidence: match.confidence,
    researchRequired: true,
  }));
}

type CorrectedResearchTarget = {
  canonicalName: string;
  aliases: string[];
  regions: string[];
  ingredients: string[];
  sensory: string[];
  why: string;
  whatWouldConfirm: string[];
  confidence: Confidence;
};

const correctedResearchTargets: CorrectedResearchTarget[] = correctedResearchTargetsData.targets as CorrectedResearchTarget[];

function correctedNameHypotheses(memory: CollectedFoodMemory): DishHypothesis[] {
  const text = normalizeForLooseMatch(memory.normalizedMemory);
  const possibleNames = memory.extractedClues.possibleDishNames.map(normalizeForLooseMatch);
  const regions = memory.extractedClues.culturalOrRegionalHints.map(normalizeForLooseMatch);
  const ingredients = memory.extractedClues.rememberedIngredients.map(normalizeForLooseMatch);
  const sensory = memory.extractedClues.sensoryClues.map(normalizeForLooseMatch);

  const matches = correctedResearchTargets.filter((target) => {
    const aliases = target.aliases.map(normalizeForLooseMatch);
    const aliasMatch = aliases.some((alias) =>
      text.includes(alias) || possibleNames.some((name) => name.includes(alias) || alias.includes(name)),
    );
    if (!aliasMatch) return false;

    const targetRegions = target.regions.map(normalizeForLooseMatch);
    const targetIngredients = target.ingredients.map(normalizeForLooseMatch);
    const targetSensory = target.sensory.map(normalizeForLooseMatch);
    const regionMatch = regions.length === 0 || targetRegions.some((targetRegion) =>
      regions.some((region) => region.includes(targetRegion) || targetRegion.includes(region)),
    );
    const ingredientMatch = targetIngredients.some((targetIngredient) =>
      text.includes(targetIngredient) || ingredients.some((ingredient) => ingredient.includes(targetIngredient) || targetIngredient.includes(ingredient)),
    );
    const sensoryMatch = targetSensory.some((targetSense) =>
      text.includes(targetSense) || sensory.some((sense) => sense.includes(targetSense) || targetSense.includes(sense)),
    );

    return regionMatch && (ingredientMatch || sensoryMatch || regions.length > 0);
  });

  return matches.map((match) => ({
    name: match.canonicalName,
    whyPossible: [
      match.why,
      'research should start from the corrected candidate while keeping the original user wording as evidence',
    ],
    whatWouldConfirm: match.whatWouldConfirm,
    confidence: match.confidence,
    researchRequired: true,
  }));
}

function buildDescriptiveHypothesis(memory: CollectedFoodMemory): DishHypothesis | null {
  const region = memory.extractedClues.culturalOrRegionalHints[0];
  const sensory = memory.extractedClues.sensoryClues;
  const ingredients = memory.extractedClues.rememberedIngredients;
  const text = memory.normalizedMemory.toLowerCase();

  if (!region && sensory.length === 0 && ingredients.length === 0) return null;

  // Detect food format from text and sensory clues
  const isSweet = sensory.some((s) => s.includes('sweet')) || text.includes('sweet') || text.includes('sugar') || text.includes('caramel');
  const isSavory = ingredients.some((ingredient) => /meat|beef|pork|chicken|fish|cheese|olive|garlic|oregano|vinegar|sesame|soy/.test(ingredient))
    || sensory.some((s) => /savory|umami|peppery/.test(s))
    || /\b(?:savory|meat|beef|pork|chicken|fish|cheese|olive|garlic|oregano|vinegar|sesame|soy)\b/i.test(text);
  const isSoup = sensory.some((s) => s.includes('soup') || s.includes('broth')) || text.includes('soup') || text.includes('broth');
  const isFried = sensory.some((s) => s.includes('fried') || s.includes('crispy')) || text.includes('fried') || text.includes('crispy');
  const isBread = text.includes('bread') || text.includes('loaf') || text.includes('roll') || text.includes('bun');
  const isCandy = isSweet && (text.includes('candy') || text.includes('wrapped') || text.includes('paper') || text.includes('rectangle') || sensory.some((s) => s.includes('grainy') || s.includes('crystalline') || s.includes('chewy')));
  const isCookie = text.includes('cookie') || text.includes('biscuit') || sensory.some((s) => s.includes('cookie'));
  const isCake = text.includes('cake') || text.includes('pastry');
  const isDrink = /\b(?:drink|beverage|sip|foamy|not curdled|over ice|soda|tea|coffee|juice drink)\b/i.test(text);

  const regionPhrase = region || 'the region';

  let descriptor = '';
  if (isSweet && isSavory) descriptor = 'sweet-savory composed dish';
  else if (isCandy) descriptor = 'candy or confection';
  else if (isCookie) descriptor = 'cookie or biscuit';
  else if (isCake) descriptor = 'cake or pastry';
  else if (isBread) descriptor = 'bread or baked good';
  else if (isSoup) descriptor = 'soup or stew';
  else if (isDrink) descriptor = 'drink or beverage';
  else if (isFried) descriptor = 'fried dish';
  else if (isSweet) descriptor = 'sweet dish or dessert';
  else descriptor = 'traditional dish';

  const textureWords = sensory.filter((s) => s.includes('texture') || s.includes('soft') || s.includes('crispy') || s.includes('chewy') || s.includes('grainy') || s.includes('creamy'));
  const flavorWords = sensory.filter((s) => s.includes('sweet') || s.includes('sour') || s.includes('spicy') || s.includes('bitter') || s.includes('rich') || s.includes('smoky') || s.includes('umami'));
  const clueSummary = unique([
    ingredients.length > 0 ? ingredients.slice(0, 2).join(' and ') : '',
    sensory.length > 0 ? sensory.slice(0, 2).join(', ') : '',
    memory.extractedClues.occasions.length > 0 ? memory.extractedClues.occasions.slice(0, 1).join(', ') : '',
  ]).filter(Boolean).join('; ');

  const texturePhrase = textureWords.length > 0 ? ` with ${textureWords.slice(0, 2).join(', ').replace(/,([^,]*)$/, ' and$1')}` : '';
  const flavorPhrase = flavorWords.length > 0 ? `, ${flavorWords.slice(0, 2).join('/')} in flavor` : '';
  const ingredientPhrase = ingredients.length > 0 ? ` made with ${ingredients.slice(0, 2).join(' and ')}` : '';

  const name = ingredients.length > 0
    ? `Unidentified ${descriptor} with ${ingredients.slice(0, 2).join(' and ')}`
    : `Unidentified ${descriptor}`;

  return {
    name,
    whyPossible: [
      clueSummary ? `You mentioned: ${clueSummary}` : 'The memory has a few sensory or context clues but no stable dish name yet.',
      'Not enough detail to name the dish yet, but we can still test the memory with a small sensory cue.',
    ],
    whatWouldConfirm: ['exact dish name or local nickname', 'how it was made or served', 'who made it or on what occasion'],
    confidence: sensory.length >= 2 && region && !isBroadRegionalHint(region) ? 'Medium' : 'Low',
    researchRequired: true,
  };
}

function genericHypotheses(memory: CollectedFoodMemory): DishHypothesis[] {
  const names = memory.extractedClues.possibleDishNames;

  const corrected = correctedNameHypotheses(memory);
  if (corrected.length > 0) {
    return corrected.slice(0, 3);
  }

  const inferred = inferredHypotheses(memory);
  if (inferred.length > 0) {
    return inferred.slice(0, 3);
  }

  if (names.length > 0) {
    return names.slice(0, 3).map((name) => ({
      name,
      whyPossible: ['user supplied a possible dish name or sound-alike fragment that should be researched before recipe generation'],
      whatWouldConfirm: ['original language spelling', 'region/town', 'ingredients', 'cooking method', 'occasion'],
      confidence: memory.extractedClues.culturalOrRegionalHints.length > 0 ? 'Medium' : 'Low',
      researchRequired: true,
    }));
  }

  // Build a descriptive hypothesis from the user's actual clues instead of saying "unknown"
  const descriptive = buildDescriptiveHypothesis(memory);
  if (descriptive) {
    return [descriptive];
  }

  return [
    {
      name: 'unknown food memory',
      whyPossible: ['the memory contains sensory or ingredient fragments but no stable dish name yet'],
      whatWouldConfirm: ['region', 'language', 'main ingredient', 'texture', 'serving context'],
      confidence: 'Low',
      researchRequired: true,
    },
  ];
}

export function planDishResearch(memory: CollectedFoodMemory): DishResearchPlan {
  const hypotheses = dataDrivenHypotheses(memory);
  const finalHypotheses = hypotheses.length > 0 ? hypotheses : genericHypotheses(memory);
  const contextTerms = unique([
    ...memory.extractedClues.culturalOrRegionalHints,
    ...memory.extractedClues.rememberedIngredients,
    ...memory.extractedClues.sensoryClues,
  ]).slice(0, 4).join(' ');
  const nameQueries = finalHypotheses.flatMap((hypothesis) => [
    `"${hypothesis.name}" ${contextTerms} spelling regional name`.trim(),
    `"${hypothesis.name}" traditional dish ingredients technique`,
    `"${hypothesis.name}" regional variations family recipe`,
  ]);
  const fragmentQueries = memory.extractedClues.possibleDishNames.map(
    (fragment) => `"${fragment}" food ${memory.extractedClues.culturalOrRegionalHints.join(' ')}`.trim(),
  );

  return {
    researchRequired: true,
    hypotheses: finalHypotheses,
    searchQueries: unique([...nameQueries, ...fragmentQueries]).slice(0, 8),
    preferredSourceTypes: [
      'family/community recipe sources',
      'bilingual or regional food writing',
      'technique videos showing texture and process',
      'ingredient/source references',
    ],
    factsToVerify: [
      'base ingredient, beverage base, or starch',
      'cooking, extraction, mixing, or serving method',
      'regional names and spelling variants',
      'holiday or family occasion context',
      'sensory cues: aroma, texture, flavor, appearance, temperature, or dilution',
    ],
    questionsForUser: memory.nextQuestions,
  };
}
