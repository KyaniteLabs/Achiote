import type { CueComponent } from './types.js';
import type { FoodScienceCueProfile } from './cue-profile-engine.js';

export type ConstraintClass = 'vegan' | 'vegetarian' | 'gluten-free' | 'nut-allergy' | 'halal' | 'kosher' | 'dairy-free' | 'pork-free';

export type ConstraintGuidance = Pick<FoodScienceCueProfile, 'accessibilityPrinciples' | 'substituteLogic' | 'safetyNotes'>;

export type ConstraintAdapterOutput = {
  profile: FoodScienceCueProfile;
  guidance: ConstraintGuidance;
  classes: Set<ConstraintClass>;
};

const CONSTRAINT_PATTERNS: Array<[ConstraintClass, RegExp]> = [
  ['vegan', /\bvegan\b|\bno animal products?\b|\bplant[-\s]?based\b/i],
  ['vegetarian', /\bvegetarian\b|\bmeat[-\s]?free\b|\bno meat\b/i],
  ['gluten-free', /\bgluten[-\s]?free\b|\bceliac\b|\bcoeliac\b|\bno gluten\b|\bwheat[-\s]?free\b/i],
  ['nut-allergy', /\bnut allerg|\bpeanut allerg|\btree nuts?\b|\bpeanut[-\s]?free\b|\bnut[-\s]?free\b|\bno peanuts?\b|\bno nuts?\b|\ballergic to (?:peanuts?|tree nuts?|nuts?)\b/i],
  ['halal', /\bhalal\b/i],
  ['kosher', /\bkosher\b/i],
  ['dairy-free', /\bdairy[-\s]?free\b|\blactose[-\s]?free\b|\bno dairy\b|\blactose intolerant\b|\bmilk allerg|\bno milk\b/i],
  ['pork-free', /\bpork[-\s]?free\b|\bno pork\b/i],
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function classifyConstraintClasses(constraints?: string[]): Set<ConstraintClass> {
  const classes = new Set<ConstraintClass>();
  const text = (constraints ?? []).join(' ');
  for (const [constraintClass, pattern] of CONSTRAINT_PATTERNS) {
    if (pattern.test(text)) classes.add(constraintClass);
  }
  return classes;
}

function hasAnyConstraint(classes: Set<ConstraintClass>, values: ConstraintClass[]): boolean {
  return values.some((value) => classes.has(value));
}

function replaceConstraintText(text: string, replacements: Array<[RegExp | string, string]>): string {
  return replacements.reduce((current, [from, to]) => current.replace(from, to), text);
}

function enforceKnownConstraintTerms(text: string, classes: Set<ConstraintClass>): string {
  let rewritten = text;

  if (classes.has('gluten-free')) {
    rewritten = replaceConstraintText(rewritten, [
      [/\bflour tortilla\b/gi, 'certified gluten-free corn carrier'],
      [/\bbread\b/gi, 'rice cake'],
      [/\bcracker\b/gi, 'certified gluten-free crisp rice carrier'],
      [/\btortilla\b/gi, 'certified gluten-free corn carrier'],
      [/\bnoodle\b/gi, 'rice starch carrier'],
      [/\bwheat\b/gi, 'certified gluten-free grain'],
    ]);
  }

  if (hasAnyConstraint(classes, ['vegan', 'vegetarian'])) {
    rewritten = replaceConstraintText(rewritten, [
      [/\bfat-rendered\b/gi, 'oil-carried'],
      [/\brendered fat\b/gi, 'oil-carried aromatics'],
      [/\bground pork\b|\bpork\b|\bchicken thigh\b|\bchicken\b|\blamb\b|\bbeef\b|\bmeat\b|\bsausage\b|\bfish\b|\bshark\b/gi, 'plant-based protein'],
      [/\bcheese\b|\bdairy\b|\byogurt\b|\bmilk\b/gi, 'plant-based creamy carrier'],
      [/\bbutter\b/gi, 'olive oil'],
      [/\bcertified compliant protein\b|\bcertified compliant meat\b/gi, 'plant-based protein'],
      [/\bproteins that render fat\b/gi, 'Plant proteins and oils'],
      [/\brender fat\b/gi, 'carry oil-soluble browning notes'],
    ]);
  } else if (hasAnyConstraint(classes, ['halal', 'kosher', 'pork-free'])) {
    const compliantProteinReplacements: Array<[RegExp, string]> = hasAnyConstraint(classes, ['halal', 'kosher'])
      ? [
          [/\bfat-rendered\b/gi, 'certified compliant fat-driven'],
          [/\bground pork\b|\bpork\b|\bchicken thigh\b|\bchicken\b|\bbeef\b|\blamb\b|\bmeat\b/gi, 'certified compliant protein'],
          [/\brendered fat\b/gi, 'certified compliant fat or oil'],
          [/\brender fat\b/gi, 'carry certified compliant fat-soluble browning notes'],
        ]
      : [
          [/\bground pork\b|\bpork\b/gi, 'pork-free protein'],
          [/\brendered fat\b/gi, 'pork-free fat or oil'],
        ];
    rewritten = replaceConstraintText(rewritten, compliantProteinReplacements);
  }

  if (classes.has('dairy-free')) {
    rewritten = replaceConstraintText(rewritten, [
      [/\bdairy-based\b/gi, 'oil-herb or tomato-based'],
      [/\bcheese\b|\bdairy\b|\byogurt\b|\bmilk\b/gi, 'plant-based creamy carrier'],
      [/\bbutter\b/gi, 'olive oil'],
    ]);
  }

  if (classes.has('nut-allergy')) {
    rewritten = replaceConstraintText(rewritten, [
      [/\bcoconut milk\b/gi, 'olive-oil-enriched broth'],
      [/\bpeanuts?\b|\btree nuts?\b|\bnuts?\b/gi, 'allergy-safe ingredient'],
    ]);
  }

  return rewritten;
}

export function rewriteCueIngredientForConstraints(item: string, classes: Set<ConstraintClass>): string {
  let rewritten = item;

  if (classes.has('gluten-free')) {
    rewritten = replaceConstraintText(rewritten, [
      [
        'cassava-family carrier matching the remembered base: frozen yuca/cassava, canned yuca, tapioca-starch paste, or plantain crisped in oil',
        'certified gluten-free cassava-family carrier matching the remembered base: frozen yuca/cassava, canned yuca, tapioca-starch paste, or plantain crisped in oil',
      ],
      [
        'starch, bread, potato, rice, bean, noodle, or cooked vegetable',
        'certified gluten-free carrier: rice, potato, corn, bean, or cooked vegetable',
      ],
      [
        'neutral carrier such as bread, rice, potato, cracker, tortilla, or cooked starch',
        'certified gluten-free neutral carrier such as rice, potato, corn cake, or cooked starch',
      ],
      [
        'neutral carrier such as oil, water, bread, rice, or potato',
        'neutral carrier such as oil, water, rice, corn cake, or potato',
      ],
    ]);
  }

  if (hasAnyConstraint(classes, ['vegan', 'vegetarian'])) {
    rewritten = replaceConstraintText(rewritten, [
      [
        'small amount of accessible protein, fat, dairy, mushroom, bean, or plant-based substitute if relevant',
        'small amount of plant-based umami/fat carrier such as beans, mushrooms, tofu, or olive oil',
      ],
      [
        'safe liquid from the remembered family: water for watery/cold clues, broth for savory soup clues, milk or plant milk only when body was remembered',
        'water, vegetable broth, or olive-oil-enriched plant liquid carrier',
      ],
      [
        'tiny fat source such as oil, butter, rendered fat, or coconut milk if relevant',
        'tiny plant-based fat source such as olive oil if relevant',
      ],
      [
        'pantry sauce base matching the researched direction: tomato, dairy, oil, vinegar, fruit, chile, or stock',
        'pantry sauce base matching the researched direction: tomato, oil, vinegar, fruit, chile, herb, or vegetable stock',
      ],
    ]);
  }

  if (!hasAnyConstraint(classes, ['vegan', 'vegetarian']) && hasAnyConstraint(classes, ['halal', 'kosher', 'pork-free'])) {
    rewritten = replaceConstraintText(rewritten, [
      [
        'small amount of accessible protein, fat, dairy, mushroom, bean, or plant-based substitute if relevant',
        'small amount of compliant protein/fat carrier such as beans, mushrooms, tofu, olive oil, or certified compliant meat',
      ],
      [
        'tiny fat source such as oil, butter, rendered fat, or coconut milk if relevant',
        'tiny compliant fat source such as olive oil or coconut milk if relevant',
      ],
    ]);
  }

  if (classes.has('dairy-free')) {
    rewritten = replaceConstraintText(rewritten, [
      [
        'safe liquid from the remembered family: water for watery/cold clues, broth for savory soup clues, milk or plant milk only when body was remembered',
        'water, broth, or olive-oil-enriched plant liquid carrier',
      ],
      [
        'tiny fat source such as oil, butter, rendered fat, or coconut milk if relevant',
        'tiny plant-based fat source such as olive oil if relevant',
      ],
      [
        'small amount of accessible protein, fat, dairy, mushroom, bean, or plant-based substitute if relevant',
        'small amount of accessible plant-based protein/fat carrier such as mushroom, bean, tofu, or olive oil',
      ],
      [
        'pantry sauce base matching the researched direction: tomato, dairy, oil, vinegar, fruit, chile, or stock',
        'pantry sauce base matching the researched direction: tomato, oil, vinegar, fruit, chile, or stock',
      ],
    ]);
  }

  return enforceKnownConstraintTerms(rewritten, classes);
}

export function rewriteCueComponentsForConstraints(components: CueComponent[], classes: Set<ConstraintClass>): CueComponent[] {
  return components.map((component) => {
    let localTestWith = component.localTestWith;

    if (classes.has('gluten-free')) {
      localTestWith = replaceConstraintText(localTestWith, [
        [
          'any grocery-store starch: potato, rice, bread, or flour tortilla',
          'any grocery-store certified gluten-free starch: potato, rice, corn cake, or cooked bean',
        ],
      ]);
    }

    if (hasAnyConstraint(classes, ['vegan', 'vegetarian'])) {
      localTestWith = replaceConstraintText(localTestWith, [
        [
          'any accessible protein: ground pork, chicken thigh, or firm tofu pan-seared in oil',
          'any accessible plant-based protein: firm tofu, mushrooms, or beans pan-seared in oil',
        ],
        ['grocery-store salsa, tomato paste with vinegar and sugar, or yogurt with herbs', 'grocery-store salsa, tomato paste with vinegar and sugar, or oil-herb sauce'],
        ['any warm broth or stock with a pinch of the remembered spice', 'any warm vegetable broth with a pinch of the remembered spice'],
      ]);
    } else if (hasAnyConstraint(classes, ['halal', 'kosher', 'pork-free'])) {
      localTestWith = replaceConstraintText(localTestWith, [
        [
          'any accessible protein: ground pork, chicken thigh, or firm tofu pan-seared in oil',
          'any accessible certified compliant protein or firm tofu pan-seared in oil',
        ],
      ]);
    }

    if (classes.has('dairy-free')) {
      localTestWith = replaceConstraintText(localTestWith, [
        ['grocery-store salsa, tomato paste with vinegar and sugar, or yogurt with herbs', 'grocery-store salsa, tomato paste with vinegar and sugar, or oil-herb sauce'],
      ]);
    }

    return {
      ...component,
      criticalElement: enforceKnownConstraintTerms(component.criticalElement, classes),
      flavorProfile: enforceKnownConstraintTerms(component.flavorProfile, classes),
      localTestWith: enforceKnownConstraintTerms(localTestWith, classes),
      substitutionReason: enforceKnownConstraintTerms(component.substitutionReason, classes),
    };
  });
}

export function buildConstraintGuidance(constraints?: string[]): ConstraintGuidance {
  const normalized = unique((constraints ?? []).map((constraint) => constraint.trim()).filter(Boolean));
  if (normalized.length === 0) return { accessibilityPrinciples: [], substituteLogic: [], safetyNotes: [] };

  const joined = normalized.join(', ');
  return {
    accessibilityPrinciples: [
      `Honor user constraints before nostalgia matching: ${joined}.`,
      'Choose the cheapest accessible proxy that satisfies the constraint instead of treating the exact ingredient as mandatory.',
    ],
    substituteLogic: [
      `For constraints (${joined}), match the sensory mechanism with compliant carriers; do not use restricted ingredients just because they are traditional.`,
    ],
    safetyNotes: [
      `Do not use ingredients that conflict with these user constraints: ${joined}.`,
      'For allergies, use clean utensils and avoid cross-contact; if uncertain, do not taste the cue.',
    ],
  };
}

export function adaptCueProfileForConstraints(profile: FoodScienceCueProfile, constraints?: string[]): ConstraintAdapterOutput {
  const classes = classifyConstraintClasses(constraints);
  const guidance = buildConstraintGuidance(constraints);
  if (classes.size === 0) return { profile, guidance, classes };

  return {
    profile: {
      ...profile,
      ingredients: profile.ingredients.map((ingredient) => ({
        ...ingredient,
        item: rewriteCueIngredientForConstraints(ingredient.item, classes),
      })),
      components: rewriteCueComponentsForConstraints(profile.components, classes),
    },
    guidance,
    classes,
  };
}
