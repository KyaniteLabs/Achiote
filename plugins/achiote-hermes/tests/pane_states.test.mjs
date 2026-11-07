/**
 * State-model tests for the Achiote dashboard pane.
 *
 * The pane must never render a failure in empty-state language. "Achiote could not be
 * reached" and "nothing reconstructed yet" lead the user to opposite actions, and the
 * earlier pane conflated them: a dead backend displayed "no reconstruction yet", telling
 * the user to go look for work that did not exist. These pin the three phases apart.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(here, "..", "dashboard", "dist", "index.js");

function loadSelectView() {
  const src = fs.readFileSync(BUNDLE, "utf8");
  const f = src.match(/function selectView\(last, dishes\) \{[\s\S]*?\n  \}/);
  assert.ok(f, "selectView present in bundle");
  // SECURITY: eval() is a test harness here. The evaluated text is selectView sliced from
  // this repo's own tracked bundle on disk. No runtime data or user input reaches it, and
  // nothing is concatenated into the body.
  return eval("(" + f[0].replace("function selectView(last, dishes)", "function(last, dishes)") + ")");
}

const selectView = loadSelectView();

test("a failed backend is phase=failed, never empty", () => {
  const v = selectView({ ok: false, error: "connection refused" }, []);
  assert.equal(v.phase, "failed");
  assert.equal(v.offline, true);
});

test("a healthy call with no work is phase=empty", () => {
  const v = selectView({ ok: true, result: {}, provenance: {} }, []);
  assert.equal(v.phase, "empty");
  assert.equal(v.offline, false);
});

test("an answer marks phase=ok", () => {
  const v = selectView({ ok: true, result: { answer: "arroz con leche" }, provenance: {} }, []);
  assert.equal(v.phase, "ok");
});

test("sources alone are enough to mark phase=ok", () => {
  const v = selectView(
    { ok: true, result: {}, provenance: { sources: [{ doi: "10.1/x" }] } },
    [],
  );
  assert.equal(v.phase, "ok");
});

test("a blank payload is a failure, not a healthy empty state", () => {
  // Nothing at all should not read as "the tool answered and there is no work".
  const v = selectView(null, undefined);
  assert.equal(v.phase, "failed");
});

test("failed and empty are rendered as different phases", () => {
  const failed = selectView({ ok: false, error: "boom" }, []);
  const empty = selectView({ ok: true, result: {}, provenance: {} }, []);
  assert.notEqual(failed.phase, empty.phase, "failure and empty must not share a phase");
});
