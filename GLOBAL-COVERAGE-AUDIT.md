# Achiote Reference Data — Global Coverage Audit

**Date:** 2026-05-30
**Scope:** Read-only audit of `src/data/` reference files. No data files were modified.
**Files analyzed:**
- `global-coverage-matrix.json`
- `reference-family-taxonomy.json`
- `dish-families.json`
- `ingredients.json`
- `reference-pantry-fixtures.json`
- `reference-seed-queue.json`
- `regional-availability.json`

---

## 1. Coverage Counts by World Culture-Area / Region

| Region | Seed / Fixture Count¹ | Dish Families (canonical) | Ingredients (commonIn) | Assessment |
|--------|----------------------:|--------------------------:|-----------------------:|:-----------|
| **East Asia** | 217 | 14 | 12 | Strong |
| **Latin America**² | 378 | 26 | 11 | Strong |
| **Middle East** | 196 | 15 | 29 | Strong |
| **South Asia** | 189 | 22 | 27 | Strong |
| **Europe (aggregate)** | 259 | 24³ | 7⁴ | Strong aggregate, but sub-regions are lopsided |
| — *Eastern Europe*⁵ | ~85 | 21 | 7 | Moderate–Strong |
| — *Western Europe*⁵ | ~30 | 2 | 7 | **Severely under-covered** |
| — *Nordic*⁵ | ~10 | 2 | 2 | **Severely under-covered** |
| **North Africa** | 168 | 2⁶ | 5 | Moderate (mostly via Mediterranean overlap) |
| **Southeast Asia** | 168 | 13 | 22 | Strong |
| **Caribbean** | 119 | 9 | 10 | Moderate |
| **West Africa** | 126 | 6 | 6 | Moderate |
| **North America** | 112 | 2 | 5 | Moderate seed count, **very low family diversity** |
| **East Africa** | 70 | 4 | 2 | **Under-covered** |
| **Central Asia** | 70 | 4 | 2 | **Under-covered** |
| **Pacific / Oceania** | 63 | 2⁷ | 0⁸ | **Under-covered** |
| **Southern Africa** | 63 | 1⁹ | 0⁸ | **Under-covered** |

¹ Seed counts are taken from `reference-seed-queue.json` `coverageTags` (`cultureAreas.*`).
² Latin America = `central_america` (203) + `south_america` (175).
³ Mediterranean (24) and Eastern Europe (21) dominate the Europe total.
⁴ `European` (7) is the only explicit pan-European tag in `ingredients.json`; Mediterranean, French, Italian, etc. are counted separately.
⁵ Europe sub-estimates derived from secondary `regions` tags inside Europe-tagged seeds (e.g. `region:Eastern Europe`, `nation:Ukraine`, `region:Scandinavia`, `region:France`).
⁶ Only `North Africa` (2) and `Mediterranean` (24) appear in `dish-families.json`.
⁷ `Pacific Islands` (2) and `Oceania and Pacific` references.
⁸ No ingredient in `ingredients.json` lists Pacific/Oceania or Southern Africa in `commonIn`.
⁹ Only `Southern Africa` (1) in `dish-families.json`.

---

## 2. Under-Represented or Missing Regions and Cuisines

### Severe gaps
- **Nordic / Scandinavia** — Only 2 canonical dish families (`smoked-fish`, `fermented-dairy`) and ~10 seeds. No dedicated pastry, bread, or savory-main families.
- **Western Europe** — Only 2 canonical families (`sweet-bread`, `egg-dish`) explicitly tagged. France, Iberia, and the Low Countries are almost invisible outside generic `Mediterranean` overlaps.
- **Pacific / Oceania** — Only 2 canonical families and 63 seeds. Aboriginal, Torres Strait Islander, Māori, and broader Polynesian/Melanesian foodways are thin.
- **Southern Africa** — 63 seeds but essentially 1 canonical family (`grilled-meat` via `braai`). Missing staple porridges, sour-milk drinks, and street foods.
- **Central Asia** — 70 seeds but only 4 families. Steppe dairy, hand-pulled noodle, and celebration sweet families are missing.
- **East Africa** — 70 seeds, 4 families. The Horn (Ethiopia/Eritrea) is slightly better covered (`doro-wat`, `tartare`→kitfo), but the Swahili coast, lake regions, and highland staples are sparse.

### Moderate gaps
- **Caribbean** — 119 seeds sounds healthy, but they cluster around only ~7 unique dishes (jamaican-patty, curry-goat, rum-cake, bammy, pikliz, hibiscus-tea, fish-broth). Under-represented: Haitian, Dominican, and eastern-Caribbean specificities.
- **North America** — 112 seeds but only 2 canonical families (`sweet-bread`, `casserole`). Indigenous foodways are split into a generic `indigenous_first_peoples` bucket (55 seeds) rather than region-specific families.
- **Central Africa** — 56 seeds, not in the 15 requested regions but notably absent from canonical families.

### Missing or token cuisines
- **Indigenous North American** — No dedicated canonical families; only a catch-all `indigenous_first_peoples` culture-area tag.
- **Arctic / Subarctic** — 50 seeds but no canonical family beyond generic `smoked-fish` and `fermented-dairy` overlaps.
- **Diaspora “noise”** — 338 seeds (26 %) carry `cultureAreas.diaspora_global`. While migration context is important, this tag may dilute region-specific retrieval when used as a primary cluster.

---

## 3. Coverage Skew Analysis

### Beverage skew
**Beverages are NOT globally over-represented.** They account for **~12 %** of seed records (154–159 of 1,288), ranking below protein-centered (~21 %), soup/broth (~17 %), and vegetable/fungi (~15 %).

However, there *is* a **regional beverage skew**:
- Latin American grain drinks dominate the beverage bucket (`horchata`, `atole`, `agua de cebada`).
- West African fermented cereals and roselle drinks are well represented.
- East Asian tea/coffee rituals, South Asian chai/lassi, and Nordic glögg/aquavit contexts are largely absent.

### Regional skew
The seed distribution is heavily weighted toward:
1. **Europe aggregate** (20 %)
2. **Latin America** (29 %)
3. **East Asia** (17 %)
4. **Middle East + South Asia** (30 % combined)

**Africa and Oceania combined** represent only **~13 %** of seeds — roughly half their proportional global population share, and far below their culinary diversity.

### Food-form skew
- **Over-weighted:** protein-centered mains, soups, sauces/condiments, confectionery.
- **Under-weighted:** breakfast (1 %), pantry/single-ingredient cues (5 %), ceremonial/holiday foods (share tags with desserts but lack dedicated families).

---

## 4. Proposed Expansion List

Each entry includes a suggested canonical name, primary culture-area tag, and food form — formatted for direct injection into `reference-seed-queue.json`.

### Pacific / Oceania *(target: deepen beyond 6–7 core dishes)*
| Proposed Seed Name | Culture-Area Tag | Food Form |
|--------------------|------------------|-----------|
| `hangi-umu-earth-oven` | `cultureAreas.oceania_pacific` | `foodForms.ceremonial_holiday` |
| `poi-taro-paste-hawaii` | `cultureAreas.oceania_pacific` | `foodForms.pantry_single_ingredient` |
| `kokoda-fiji-raw-fish` | `cultureAreas.oceania_pacific` | `foodForms.protein_centered` |
| `rewena-paraoa-maori-bread` | `cultureAreas.oceania_pacific` | `foodForms.bread_flatbread` |
| `sapasui-samoa-noodles` | `cultureAreas.oceania_pacific` | `foodForms.grain_rice_noodle` |
| `damper-australian-campfire` | `cultureAreas.oceania_pacific` | `foodForms.bread_flatbread` |
| `bougna-new-caledonia` | `cultureAreas.oceania_pacific` | `foodForms.stew_braise` |
| `palusami-samoa-taro-leaves` | `cultureAreas.oceania_pacific` | `foodForms.vegetable_fungi` |

### Central Asia *(target: add staple, dairy, and noodle families)*
| Proposed Seed Name | Culture-Area Tag | Food Form |
|--------------------|------------------|-----------|
| `beshbarmak-kazakh-noodles` | `cultureAreas.central_asia` | `foodForms.grain_rice_noodle` |
| `laghman-hand-pulled-noodles` | `cultureAreas.central_asia` | `foodForms.grain_rice_noodle` |
| `shubat-fermented-camel-milk` | `cultureAreas.central_asia` | `foodForms.beverage` |
| `baursak-fried-dough` | `cultureAreas.central_asia` | `foodForms.snack_street_food` |
| `kurt-dried-yogurt-balls` | `cultureAreas.central_asia` | `foodForms.pantry_single_ingredient` |
| `plov-uzbek-pilaf` | `cultureAreas.central_asia` | `foodForms.grain_rice_noodle` |
| `shashlik-central-asian-kebab` | `cultureAreas.central_asia` | `foodForms.protein_centered` |
| `tash-kordsak-meat-noodle` | `cultureAreas.central_asia` | `foodForms.soup_broth` |

### East Africa *(target: Swahili coast, lake region, highland staples)*
| Proposed Seed Name | Culture-Area Tag | Food Form |
|--------------------|------------------|-----------|
| `nyama-choma-kenya-grill` | `cultureAreas.east_africa` | `foodForms.protein_centered` |
| `pilau-swahili-rice` | `cultureAreas.east_africa` | `foodForms.grain_rice_noodle` |
| `sukuma-wiki-collard-greens` | `cultureAreas.east_africa` | `foodForms.vegetable_fungi` |
| `ethiopian-coffee-ceremony` | `cultureAreas.east_africa` | `foodForms.beverage` |
| `mutura-kenyan-sausage` | `cultureAreas.east_africa` | `foodForms.snack_street_food` |
| `kitfo-ethiopian-tartare` | `cultureAreas.east_africa` | `foodForms.protein_centered` |
| `injera-teff-flatbread` | `cultureAreas.east_africa` | `foodForms.bread_flatbread` |
| `samosa-swahili-coast` | `cultureAreas.east_africa` | `foodForms.snack_street_food` |

### Southern Africa *(target: porridges, sour milk, street foods)*
| Proposed Seed Name | Culture-Area Tag | Food Form |
|--------------------|------------------|-----------|
| `pap-maize-porridge` | `cultureAreas.southern_africa` | `foodForms.grain_rice_noodle` |
| `morogo-wild-spinach` | `cultureAreas.southern_africa` | `foodForms.vegetable_fungi` |
| `biltong-dried-meat` | `cultureAreas.southern_africa` | `foodForms.pantry_single_ingredient` |
| `vetkoek-fried-dough` | `cultureAreas.southern_africa` | `foodForms.snack_street_food` |
| `amarula-cream-liqueur` | `cultureAreas.southern_africa` | `foodForms.beverage` |
| `sadza-ugali-variant` | `cultureAreas.southern_africa` | `foodForms.grain_rice_noodle` |
| `kota-bunny-chow-variant` | `cultureAreas.southern_africa` | `foodForms.snack_street_food` |
| `malawi-fried-fish-chambo` | `cultureAreas.southern_africa` | `foodForms.protein_centered` |

### Nordic *(target: close the 2-family gap)*
| Proposed Seed Name | Culture-Area Tag | Food Form |
|--------------------|------------------|-----------|
| `karelian-pasty-rye-pie` | `cultureAreas.europe` | `foodForms.dumpling_pocket` |
| `lutefisk-dried-fish` | `cultureAreas.europe` | `foodForms.protein_centered` |
| `rugbrod-danish-rye-bread` | `cultureAreas.europe` | `foodForms.bread_flatbread` |
| `kanelbulle-cinnamon-bun` | `cultureAreas.europe` | `foodForms.dessert` |
| `gravlax-cured-salmon` | `cultureAreas.europe` | `foodForms.protein_centered` |
| `glogg-mulled-wine` | `cultureAreas.europe` | `foodForms.beverage` |
| `cloudberry-jam-dessert` | `cultureAreas.europe` | `foodForms.confectionery` |
| `finnish-fish-soup-lohikeitto` | `cultureAreas.europe` | `foodForms.soup_broth` |

### Western Europe *(target: add canonical families for France, Iberia, British Isles)*
| Proposed Seed Name | Culture-Area Tag | Food Form |
|--------------------|------------------|-----------|
| `coq-au-vin-burgundy` | `cultureAreas.europe` | `foodForms.stew_braise` |
| `ratatouille-provence` | `cultureAreas.europe` | `foodForms.vegetable_fungi` |
| `irish-stew-lamb` | `cultureAreas.europe` | `foodForms.soup_broth` |
| `fish-and-chips-british` | `cultureAreas.europe` | `foodForms.snack_street_food` |
| `wiener-schnitzel-austria` | `cultureAreas.europe` | `foodForms.protein_centered` |
| `caldo-verde-portugal` | `cultureAreas.europe` | `foodForms.soup_broth` |
| `cassoulet-france` | `cultureAreas.europe` | `foodForms.stew_braise` |
| `pasta-carbonara-italy` | `cultureAreas.europe` | `foodForms.grain_rice_noodle` |

### North America *(target: raise canonical family diversity beyond 2 families)*
| Proposed Seed Name | Culture-Area Tag | Food Form |
|--------------------|------------------|-----------|
| `clam-chowder-new-england` | `cultureAreas.north_america` | `foodForms.soup_broth` |
| `buffalo-wings-upstate-ny` | `cultureAreas.north_america` | `foodForms.snack_street_food` |
| `green-chile-stew-southwest` | `cultureAreas.north_america` | `foodForms.stew_braise` |
| `poutine-canada` | `cultureAreas.north_america` | `foodForms.snack_street_food` |
| `red-beans-rice-louisiana` | `cultureAreas.north_america` | `foodForms.grain_rice_noodle` |
| `three-sisters-stew-indigenous` | `cultureAreas.indigenous_first_peoples` | `foodForms.vegetable_fungi` |
| `fry-bread-indigenous` | `cultureAreas.indigenous_first_peoples` | `foodForms.bread_flatbread` |
| `lobster-roll-new-england` | `cultureAreas.north_america` | `foodForms.snack_street_food` |

### Caribbean *(target: add Haitian, Dominican, and eastern-island specificity)*
| Proposed Seed Name | Culture-Area Tag | Food Form |
|--------------------|------------------|-----------|
| `griot-haitian-pork` | `cultureAreas.caribbean` | `foodForms.protein_centered` |
| `mangu-dominican-plantain` | `cultureAreas.caribbean` | `foodForms.breakfast` |
| `ackee-saltfish-jamaica` | `cultureAreas.caribbean` | `foodForms.breakfast` |
| `callaloo-caribbean-greens` | `cultureAreas.caribbean` | `foodForms.vegetable_fungi` |
| `doubles-trinidad-chickpea` | `cultureAreas.caribbean` | `foodForms.snack_street_food` |
| `sancocho-caribbean-stew` | `cultureAreas.caribbean` | `foodForms.soup_broth` |
| `pastel-en-hoja-caribbean` | `cultureAreas.caribbean` | `foodForms.dumpling_pocket` |
| `mauby-drink-caribbean` | `cultureAreas.caribbean` | `foodForms.beverage` |

---

## 5. Methodology & Limitations

- **Seed/Fixture counts** treat `reference-seed-queue.json` as the canonical backlog and `reference-pantry-fixtures.json` as its sourced expansion. Both files share the same 1,288 underlying seeds; fixtures add full `record` objects with Wikidata/CC0 sources.
- **Europe sub-regional estimates** are inferred from secondary `regions` tags *inside* Europe-tagged seeds, because `global-coverage-matrix.json` does not split Europe into Western/Eastern/Nordic at the `cultureAreas` level.
- **Dish family counts** are based on explicit string matches in `dish-families.json` `regions` arrays.
- **Ingredient counts** are based on `commonIn` arrays in `ingredients.json`.
- This audit does **not** judge cultural accuracy of existing records — only coverage breadth and geographic distribution.
