/**
 * Citation-link tests for the Achiote dashboard pane.
 *
 * Achiote's product promise is cite-or-die: a citation the user cannot follow is worse than
 * no citation at all. `sourceHref` used to concatenate the raw DOI, so a DOI captured from
 * inline prose shipped as a live link with the wrapping punctuation still attached and 404'd
 * at the resolver. These pin the normalisation and the decision to emit no href when the
 * identifier cannot be trusted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(here, "..", "dashboard", "dist", "index.js");

function loadNormalise() {
  const src = fs.readFileSync(BUNDLE, "utf8");
  const m = src.match(/var DOI_RE = (\/\^10[^;]+?\/\S*\$\/);/);
  assert.ok(m, "DOI_RE present in bundle");
  const f = src.match(/function normaliseDoi\(raw\) \{[\s\S]*?\n  \}/);
  assert.ok(f, "normaliseDoi present in bundle");
  // SECURITY: eval() here is a test harness only. The evaluated text is `normaliseDoi` and its
  // `DOI_RE` constant sliced out of this repo's own tracked dashboard/dist/index.js read from
  // disk — no runtime data, no user input, and nothing concatenated into the body. It is the
  // only way to exercise a browser IIFE's internals in Node without a DOM. Nothing untrusted
  // reaches eval().
  return eval(
    "(function(){ var DOI_RE = " + m[1] + "; return " +
      f[0].replace("function normaliseDoi(raw)", "function(raw)") + "; })()",
  );
}

const normaliseDoi = loadNormalise();

test("wrapping punctuation from inline prose is stripped", () => {
  assert.equal(normaliseDoi("10.3389/fpls.2019.00012)"), "10.3389/fpls.2019.00012");
  assert.equal(normaliseDoi("10.3389/fpls.2019.00012."), "10.3389/fpls.2019.00012");
  assert.equal(normaliseDoi("10.3389/fpls.2019.00012,"), "10.3389/fpls.2019.00012");
  assert.equal(normaliseDoi("  <10.3389/fpls.2019.00012>  "), "10.3389/fpls.2019.00012");
});

test("common DOI prefixes are normalised away", () => {
  assert.equal(normaliseDoi("doi:10.3389/fpls.2019.00012"), "10.3389/fpls.2019.00012");
  assert.equal(normaliseDoi("https://doi.org/10.3389/fpls.2019.00012"), "10.3389/fpls.2019.00012");
  assert.equal(normaliseDoi("https://dx.doi.org/10.3389/fpls.2019.00012"), "10.3389/fpls.2019.00012");
});

test("parentheses that are legal inside a DOI survive", () => {
  // A real Crossref identifier containing balanced parentheses.
  const sici = "10.1002/(SICI)1099-0844(199912)17:4<291::AID-CBF849>3.0.CO;2-P";
  assert.equal(normaliseDoi(sici), sici);
  // The same identifier with prose wrapping on the end.
  assert.equal(normaliseDoi(sici + ")"), sici);
});

test("an identifier that cannot be trusted emits NO href", () => {
  assert.equal(normaliseDoi("not-a-doi"), "");
  assert.equal(normaliseDoi(""), "");
  assert.equal(normaliseDoi(undefined), "");
  assert.equal(normaliseDoi("10.1234/abc) def"), "");
});
