import assert from "node:assert/strict";
import { test } from "node:test";
import { readStudyLighting } from "./study-lighting.mjs";

test("both study renderers receive the scene-authored profile without substituting their own lighting", () => {
  const profile = { version: 1, environmentIntensity: .18, hemisphereIntensity: .35, sky: "#BCD8E2", ground: "#192630", exposure: 1.05 };
  assert.deepEqual(readStudyLighting({ blueprint_lighting: profile }, "cyberpunk"), profile);
});

test("old exported scenes keep their original theme-specific lighting instead of changing archived evidence", () => {
  assert.deepEqual(readStudyLighting({}, "cyberpunk"), { version: 1, environmentIntensity: .6, hemisphereIntensity: .8, sky: "#AECBD4", ground: "#283A48", exposure: 1.15 });
  assert.deepEqual(readStudyLighting({}, "eastern"), { version: 1, environmentIntensity: .35, hemisphereIntensity: 1.1, sky: "#E8EED8", ground: "#7A8980", exposure: 1.15 });
});

test("a corrupt authored profile fails rather than silently replacing a broken export with legacy lighting", () => {
  const profile = { version: 1, environmentIntensity: .18, hemisphereIntensity: .35, sky: "#BCD8E2", ground: "#192630", exposure: 1.05 };
  for (const value of [null, {}, { ...profile, version: 2 }, { ...profile, sky: "javascript:void(0)" },
    { ...profile, environmentIntensity: NaN }, { ...profile, hemisphereIntensity: -1 }, { ...profile, exposure: 683 }, { ...profile, unknown: true }]) {
    assert.throws(() => readStudyLighting({ blueprint_lighting: value }, "cyberpunk"), /Invalid authored study lighting/);
  }
  assert.throws(() => readStudyLighting({}, "unknown"), /Unknown study theme/);
});
