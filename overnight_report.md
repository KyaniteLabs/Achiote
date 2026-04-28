# Achiote Local Inference — Overnight Test Report
*Generated: 2026-04-28 06:55 UTC*
*Model: qwen3.6-35b-a3b @ http://100.66.225.85:1234/v1*

## Summary

| Status | Count |
|--------|-------|
| ✅ PASS | 28 |
| ⚠️ WARN | 0 |
| ❌ FAIL | 6 |
| 💥 ERROR | 0 |
| **TOTAL** | **34** |

## By Category

| Category | Pass | Warn | Fail | Error |
|----------|------|------|------|-------|
| conversation_history | 1 | 0 | 1 | 0 |
| edge_cases | 8 | 0 | 1 | 0 |
| guard_tests | 2 | 0 | 1 | 0 |
| happy_path | 4 | 0 | 0 | 0 |
| multilingual | 4 | 0 | 0 | 0 |
| sparse_input | 4 | 0 | 1 | 0 |
| system_edge | 3 | 0 | 0 | 0 |
| tool_quality | 2 | 0 | 2 | 0 |

## Failures & Errors

### ❌ `sparse_just_smell` (sparse_input)
*Only a smell clue, no dish name, no location*
- **Input:** `I remember something that smelled toasty and herby when it hit the table.`
- **Tools called:** collect_food_memory → plan_dish_research
- **Guard fired:** premature_candidate_speculation
- **Timing:** 41.2s | **Retries:** 0
- **Failures:**
  - MISSING TEXT: 'region' not in response
- **Response snippet:** Before I give you a tasting cue, I need one or two details so I do not fake certainty.  1. Where did you eat this, or where was it from? Even a country, island, city, or "I had it in ___" is enough. 2...

### ❌ `guard_explicit_cue_without_evidence` (guard_tests)
*Explicit cue request with very sparse memory — should trigger fallback*
- **Input:** `I remember something warm. Give me the smallest possible bite test right now.`
- **Tools called:** collect_food_memory
- **Guard fired:** missing_research_plan_clarification
- **Timing:** 28.1s | **Retries:** 0
- **Failures:**
  - MISSING TOOL: generate_minimum_viable_nostalgia (called: ['collect_food_memory'])
- **Response snippet:** Before I give you a tasting cue, I need one or two details so I do not fake certainty.  1. Where did you eat this, or where was it from? Even a country, island, city, or "I had it in ___" is enough. 2...

### ❌ `edge_recent_memory` (edge_cases)
*Very recent memory, not ancestral*
- **Input:** `My roommate made something last year and I never asked what it was. It was brigh...`
- **Tools called:** collect_food_memory → plan_dish_research → search_web
- **Guard fired:** (none)
- **Timing:** 54.8s | **Retries:** 0
- **Failures:**
  - MISSING TOOL: generate_minimum_viable_nostalgia (called: ['collect_food_memory', 'plan_dish_research', 'search_web'])
- **Response snippet:**   Thanks for those clues — bright green + very garlicky + on pasta + from the Levant is a distinctive combination. I want to make sure I'm pointing you toward the right memory, so two quick questions:...

### ❌ `quality_evidence_separation` (tool_quality)
*Verify Memory Receipt separates user-said from inferred*
- **Input:** `I remember a stew my Nigerian aunt made. It had a kind of nutty, peppery base an...`
- **Tools called:** collect_food_memory → plan_dish_research → search_web → resolve_dish_name → resolve_dish_name
- **Guard fired:** (none)
- **Timing:** 75.2s | **Retries:** 0
- **Failures:**
  - MISSING TOOL: generate_minimum_viable_nostalgia (called: ['collect_food_memory', 'plan_dish_research', 'search_web', 'resolve_dish_name', 'resolve_dish_name'])
- **Response snippet:**   Thanks for sharing this memory—it's meaningful that your aunt made this for funerals, and the nutty, peppery base with greens is a great sensory anchor.  To help me narrow this down, a few quick que...

### ❌ `quality_no_full_recipe` (tool_quality)
*Final response must not give a full recipe before confirmation*
- **Input:** `My Sicilian grandmother made something with eggplant, it was sweet and sour and ...`
- **Tools called:** collect_food_memory → plan_dish_research → resolve_dish_name → search_web → build_reconstruction_dossier → generate_minimum_viable_nostalgia
- **Guard fired:** (none)
- **Timing:** 95.6s | **Retries:** 0
- **Failures:**
  - FORBIDDEN TEXT: 'tablespoons' found in response
- **Response snippet:** Based on your clues—Sicilian, eggplant, sweet and sour, capers—this is almost certainly **caponata**, the classic Sicilian sweet-and-sour eggplant relish. The capers you mentioned are a hallmark ingre...

### ❌ `history_followup_followup` (conversation_history)
*Follow-up with more clues after initial sparse response (followup)*
- **Input:** `My grandmother was from the Philippines. And I think the sourness came from tama...`
- **Tools called:** collect_food_memory
- **Guard fired:** missing_research_plan_clarification
- **Timing:** 40.1s | **Retries:** 0
- **Failures:**
  - MISSING TOOL: plan_dish_research (called: ['collect_food_memory'])
  - MISSING TOOL: generate_minimum_viable_nostalgia (called: ['collect_food_memory'])
  - UNEXPECTED GUARD: missing_research_plan_clarification
- **Response snippet:** Before I give you a tasting cue, I need one or two details so I do not fake certainty.  1. Do you remember what people in tamarind called it, even roughly or phonetically? 2. How was the tamarind serv...

## All Results

| ID | Category | Status | Tools | Guard | Time | Retries |
|----|----------|--------|-------|-------|------|---------|
| `happy_dill_soup` | happy_path | ✅ pass | collect, plan_research, build_reconstruction_dossi | — | 124.6s | 0 |
| `happy_phonetic_pasteles` | happy_path | ✅ pass | collect, resolve_name, plan_research, build_recons | — | 165.3s | 0 |
| `happy_bun_shark_trinidad` | happy_path | ✅ pass | collect, plan_research, search_web, resolve_name,  | — | 141.3s | 0 |
| `happy_explicit_cue_request` | happy_path | ✅ pass | collect, plan_research, search_web, build_reconstr | — | 118.2s | 0 |
| `sparse_just_smell` | sparse_input | ❌ fail | collect, plan_research | pre_candidate_speculation | 41.2s | 0 |
| `sparse_color_only` | sparse_input | ✅ pass | collect, plan_research | — | 45.1s | 0 |
| `sparse_feeling_only` | sparse_input | ✅ pass | collect | no_plan_clari. | 25.0s | 0 |
| `sparse_single_ingredient` | sparse_input | ✅ pass | collect | no_plan_clari. | 20.1s | 0 |
| `sparse_texture_only` | sparse_input | ✅ pass | collect | no_plan_clari. | 24.2s | 0 |
| `multi_tagalog_clue` | multilingual | ✅ pass | collect, plan_research, search_web, resolve_name,  | — | 125.2s | 0 |
| `multi_hindi_fragment` | multilingual | ✅ pass | collect, resolve_name, search_web, plan_research,  | — | 137.8s | 0 |
| `multi_spanish_abuela` | multilingual | ✅ pass | collect | no_plan_clari. | 25.2s | 0 |
| `multi_full_foreign_language` | multilingual | ✅ pass | collect, plan_research, resolve_name, search_web,  | — | 149.2s | 0 |
| `guard_generic_uncertainty` | guard_tests | ✅ pass | collect | no_plan_clari. | 25.3s | 0 |
| `guard_premature_speculation` | guard_tests | ✅ pass | collect | no_plan_clari. | 24.6s | 0 |
| `guard_explicit_cue_without_evidence` | guard_tests | ❌ fail | collect | no_plan_clari. | 28.1s | 0 |
| `edge_very_long` | edge_cases | ✅ pass | collect, plan_research, resolve_name, search_web,  | — | 168.1s | 0 |
| `edge_already_knows_dish` | edge_cases | ✅ pass | collect, plan_research, resolve_name, search_web,  | — | 122.5s | 0 |
| `edge_wrong_name_confident` | edge_cases | ✅ pass | collect, plan_research, search_web, search_web, re | — | 144.5s | 0 |
| `edge_multiple_dishes_confused` | edge_cases | ✅ pass | collect, collect, plan_research, plan_research, bu | — | 180.1s | 0 |
| `edge_only_location` | edge_cases | ✅ pass | collect | no_plan_clari. | 24.7s | 0 |
| `edge_injection_attempt` | edge_cases | ✅ pass | collect | no_plan_clari. | 18.1s | 0 |
| `edge_nonsense_input` | edge_cases | ✅ pass | collect | no_plan_clari. | 23.3s | 0 |
| `edge_no_family_just_restaurant` | edge_cases | ✅ pass | collect, plan_research, search_web, resolve_name,  | — | 165.1s | 0 |
| `edge_recent_memory` | edge_cases | ❌ fail | collect, plan_research, search_web | — | 54.8s | 0 |
| `quality_location_extraction` | tool_quality | ✅ pass | collect, plan_research, resolve_name, search_web,  | — | 149.5s | 0 |
| `quality_evidence_separation` | tool_quality | ❌ fail | collect, plan_research, search_web, resolve_name,  | — | 75.2s | 0 |
| `quality_no_full_recipe` | tool_quality | ❌ fail | collect, plan_research, resolve_name, search_web,  | — | 95.6s | 0 |
| `quality_grocery_substitutes` | tool_quality | ✅ pass | collect, plan_research, search_web, resolve_name,  | — | 124.1s | 0 |
| `history_followup` | conversation_history | ✅ pass | collect | no_plan_clari. | 21.6s | 0 |
| `history_followup_followup` | conversation_history | ❌ fail | collect | no_plan_clari. | 40.1s | 0 |
| `system_empty_message` | system_edge | ✅ pass | — | — | Nones | 0 |
| `system_whitespace_message` | system_edge | ✅ pass | — | — | Nones | 0 |
| `system_no_auth` | system_edge | ✅ pass | — | — | Nones | 0 |

---
*End of report.*