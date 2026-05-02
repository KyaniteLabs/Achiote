import type { Confidence, CueComponent, MinimumViableNostalgiaCue } from './types.js';

export type FoodScienceCueProfile = {
  format: MinimumViableNostalgiaCue['format'];
  title: string;
  goal: string;
  effortMinutes: number;
  ingredients: MinimumViableNostalgiaCue['ingredients'];
  steps: string[];
  preserves: string[];
  doesNotPreserve: string[];
  accessibilityPrinciples: string[];
  substituteLogic: string[];
  whyThisIsMinimum: string;
  safetyNotes: string[];
  followUpIfItWorks: string[];
  components: CueComponent[];
};

export type CueProfileEngineInput = {
  signals: string;
  userLocation?: string;
  confidence?: Confidence;
  forceProbe?: boolean;
  buildProfile: (
    signals: string,
    userLocation?: string,
    confidence?: Confidence,
    forceProbe?: boolean,
  ) => FoodScienceCueProfile;
  decomposeComponents: (
    signals: string,
    userLocation?: string,
    confidence?: Confidence,
  ) => CueComponent[];
};

export type CueProfileEngineOutput = {
  profile: FoodScienceCueProfile;
  components: CueComponent[];
  mechanismLanguage: string[];
  accessibilityPrinciples: string[];
  localTestText: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function runCueProfileEngine(input: CueProfileEngineInput): CueProfileEngineOutput {
  const profile = input.buildProfile(input.signals, input.userLocation, input.confidence, input.forceProbe);
  const components = profile.components.length > 0
    ? profile.components
    : input.decomposeComponents(input.signals, input.userLocation, input.confidence);
  const profileWithComponents = { ...profile, components };

  return {
    profile: profileWithComponents,
    components,
    mechanismLanguage: unique(components.flatMap((component) => [
      component.criticalElement,
      component.flavorProfile,
      component.substitutionReason,
    ])),
    accessibilityPrinciples: unique(profile.accessibilityPrinciples),
    localTestText: unique([
      ...profile.ingredients.map((ingredient) => `${ingredient.item}: ${ingredient.purpose}`),
      ...components.map((component) => component.localTestWith),
    ]),
  };
}
