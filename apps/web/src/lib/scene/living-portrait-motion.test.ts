import { describe, expect, test } from "vitest";
import { advancePortraitTime, layerOffset, stageFraming } from "./living-portrait-motion";
import { breathingDeformation, breathAt } from "./living-portrait-rig";

describe("image-based wuxia scene motion", () => {
  test("breathing remains visible when the wind control is zero", () => {
    expect(Math.abs(breathingDeformation(725, 370, breathAt(2)).y)).toBeGreaterThan(.5);
  });
  test("pause freezes time; resuming after a hidden tab never catches up elapsed wall time", () => {
    expect(advancePortraitTime(12, 90, false)).toBe(12);
    expect(advancePortraitTime(12, 90, true)).toBeCloseTo(12 + 1 / 30);
    expect(advancePortraitTime(12, Number.NaN, true)).toBe(12);
  });

  test("foreground and scenery move relatively, with bounded pointer input", () => {
    const back = layerOffset("background", { x: 1, y: 1 });
    const front = layerOffset("foreground", { x: 1, y: 1 });
    expect(front.x - back.x).toBeGreaterThan(12);
    expect(layerOffset("foreground", { x: 100, y: -100 })).toEqual(layerOffset("foreground", { x: 1, y: -1 }));
    expect(layerOffset("foreground", { x: NaN, y: Infinity })).toEqual({ x: 0, y: 0 });
  });

  test("desktop and narrow frames cover without stretching the source and keep overscan", () => {
    for (const [width, height] of [[1440, 811], [390, 488]]) {
      const frame = stageFraming(width, height);
      expect(1670 * frame.scale).toBeGreaterThan(width);
      expect(941 * frame.scale).toBeGreaterThan(height);
      expect(Number.isFinite(frame.x)).toBe(true);
    }
  });
});
