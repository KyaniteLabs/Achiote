import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

// 2026-11-07 audit, ledger row 5: on /app the microphone button carried hidden="true" yet still
// painted as a 44x44 grid box and swallowed a real click, because `.icon-btn { display: inline-grid }`
// outranks the user-agent `[hidden] { display: none }` rule. research-app.js only unhides the mic
// after /voice/status reports stt.ready, so a painted mic while STT is unavailable is an inert
// control: nothing visible happens when it is clicked.
//
// The browser-level proof (real Chrome, before/after) lives on repair card t_a3ef5594. These checks
// keep the unavailable state unavailable in CI, where no browser runs.

const appHtml = () => fs.readFileSync('docs/landing/app.html', 'utf8');
const siteCss = () => fs.readFileSync('docs/landing/site.css', 'utf8');
const researchAppJs = () => fs.readFileSync('docs/landing/research-app.js', 'utf8');

type Rule = { selector: string; body: string };

/** Flatten a stylesheet into rules, unwrapping @media/@supports blocks (their conditions only
 *  restyle the recording state here, so specificity/order of declarations is what matters). */
function cssRules(css: string): Rule[] {
  const out: Rule[] = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    if (prelude.startsWith('@')) out.push(...cssRules(body));
    else if (prelude) out.push({ selector: prelude, body });
    i = j;
  }
  return out;
}

/** Specificity as [ids, classes+attrs+pseudo-classes, types+pseudo-elements]. */
function specificity(selector: string): [number, number, number] {
  const s = selector.trim();
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+/g) ?? []).length
    + (s.match(/\[[^\]]*\]/g) ?? []).length
    + (s.match(/:(?!:)[\w-]+(\([^)]*\))?/g) ?? []).length;
  const pseudoElements = (s.match(/::[\w-]+/g) ?? []).length;
  const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, ' ')
    .match(/[a-zA-Z][\w-]*/g) ?? []).length;
  return [ids, classes, types + pseudoElements];
}

/** Does this simple compound match the mic button in its speech-to-text-unavailable state?
 *  Markup: <button class="icon-btn" id="mic-btn" type="button" hidden aria-pressed="false">.
 *  Only compounds of id/class/attribute selectors are evaluated; anything structural
 *  (descendant/child/sibling combinators, type selectors) is out of scope for this guard. */
function matchesUnavailableMic(selector: string): boolean {
  const parts = selector.match(/([#.[][^#.[\s>+~]+|:[a-z-]+(?:\([^)]*\))?)/gi) ?? [];
  const leftover = selector.replace(/([#.[][^#.[\s>+~]+|:[a-z-]+(?:\([^)]*\))?)/gi, '').trim();
  if (leftover) return false;
  return parts.every((p) => {
    if (p.startsWith('#')) return p === '#mic-btn';
    if (p.startsWith('.')) return p === '.icon-btn';
    if (/^\[hidden\]$/i.test(p)) return true;
    if (/^\[aria-pressed\s*=\s*["']?false["']?\]$/i.test(p)) return true;
    return false; // any other class/attribute/pseudo (e.g. .recording, :hover) is not active here
  });
}

function displayDeclarations(): Array<{
  selector: string;
  display: string;
  important: boolean;
  spec: [number, number, number];
  order: number;
}> {
  const rules = [...cssRules(appHtml()), ...cssRules(siteCss())];
  const decls: ReturnType<typeof displayDeclarations> = [];
  rules.forEach((rule, order) => {
    const m = rule.body.match(/(?:^|;)\s*display\s*:\s*([^;]+)/i);
    if (!m) return;
    const important = /!important/i.test(m[1]);
    const display = m[1].replace(/\s*!important\s*$/i, '').trim().toLowerCase();
    for (const selector of rule.selector.split(',').map((s) => s.trim()).filter(Boolean)) {
      decls.push({ selector, display, important, spec: specificity(selector), order });
    }
  });
  return decls;
}

describe('app page: the microphone control is unavailable when speech-to-text is unavailable', () => {
  it('ships #mic-btn hidden, so it cannot paint before /voice/status answers', () => {
    expect(appHtml()).toMatch(/<button[^>]*\bid="mic-btn"[^>]*\shidden(?:\s|>)/);
  });

  it('computes display:none for #mic-btn while it is hidden (the `hidden` attribute beats .icon-btn)', () => {
    const candidates = displayDeclarations().filter((d) => matchesUnavailableMic(d.selector));
    // The cascade for this element in the unavailable state: rank by importance, specificity,
    // then source order, exactly like the browser does for author declarations.
    const rank = (d: (typeof candidates)[number]) => [
      d.important ? 1 : 0,
      ...d.spec,
      d.order,
    ];
    const winner = candidates.reduce((best, d) => {
      const a = rank(d);
      const b = rank(best);
      for (let k = 0; k < a.length; k++) {
        if (a[k] !== b[k]) return a[k] > b[k] ? d : best;
      }
      return best;
    });
    expect(
      winner.selector,
      `winning display rule for the unavailable mic is "${winner.selector}" (display:${winner.display}); it must be a [hidden] display:none rule`,
    ).toContain('[hidden]');
    expect(winner.display).toBe('none');
    // A !important display declaration that targets this button would bypass the ranking above.
    expect(
      displayDeclarations().filter(
        (d) =>
          d.important &&
          (/#mic-btn/.test(d.selector) || /\.icon-btn/.test(d.selector) || /(^|[\s,>+~])button\b/.test(d.selector) || /(^|[\s,>+~])\*/.test(d.selector)),
      ),
    ).toEqual([]);
  });

  it('only reveals the mic after /voice/status reports stt.ready and the browser can record', () => {
    const js = researchAppJs();
    expect(js).toMatch(/var ready = cfg && cfg\.stt && cfg\.stt\.ready;/);
    expect(js).toMatch(/if \(!ready \|\| !canRecord\) return;/);
    expect(js.indexOf('voiceReady = true;')).toBeGreaterThan(-1);
    expect(js.indexOf('voiceReady = true;')).toBeLessThan(js.indexOf('micBtn.hidden = false;'));
    // Defense in depth: even a forced click on a hidden mic must not run the recorder.
    expect(js).toMatch(/function toggleMic\(\) \{\s*if \(!voiceReady\) return;/);
  });
});
