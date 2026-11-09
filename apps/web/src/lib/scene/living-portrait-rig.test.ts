import { describe, expect, test } from "vitest";
import { breathingDeformation, breathAt, CHARACTER_PLACEMENT, IDLE_CHAINS, IdleRig, sampleSecondaryMotion } from "./living-portrait-rig";

describe("independent portrait idle rig", () => {
  test("head follows breathing as one rigid part, including the face", () => {
    const points = [[735, 118], [768, 148], [764, 190], [759, 211]];
    const posed = points.map(([x, y]) => {
      const d = breathingDeformation(x, y, breathAt(2)); return [x + d.x, y + d.y];
    });
    expect(Math.abs(posed[0][1] - points[0][1])).toBeGreaterThan(.6);
    for (let i = 1; i < points.length; i++) {
      expect(Math.hypot(posed[i][0] - posed[0][0], posed[i][1] - posed[0][1]))
        .toBeCloseTo(Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]), 9);
    }
  });
  test("hands, sword and seated lower body remain pinned throughout a breath", () => {
    for (let t = 0; t <= 12; t += .17) {
      for (const [x, y] of [[620, 490], [905, 555], [1140, 605], [780, 580]]) {
        expect(breathingDeformation(x, y, breathAt(t))).toEqual({ x: 0, y: 0 });
      }
    }
  });
  test("breathing is independent of wind and has a continuous slower exhale", () => {
    const rig = new IdleRig(); for (let i = 0; i < 120; i++) rig.advance(1 / 60, 0);
    expect(Math.abs(breathingDeformation(742, 335, rig.breath).y)).toBeGreaterThan(1);
    expect(breathAt(0)).toBe(0); expect(breathAt(5.8)).toBeCloseTo(0);
    expect(breathAt(2.2)).toBeCloseTo(1); expect(breathAt(4)).toBeCloseTo(.5);
  });
  test("anchored chains keep lengths and fixed roots; free tips respond to wind", () => {
    const rig = new IdleRig(); for (let i = 0; i < 600; i++) rig.advance(1 / 60, 1);
    let movingTips = 0;
    for (const chain of rig.chains) {
      const source = IDLE_CHAINS.find(item => item.name === chain.name)!;
      const carrier = breathingDeformation(source.points[0][0], source.points[0][1], rig.breath);
      expect(chain.nodes[0].x).toBeCloseTo(source.points[0][0] + carrier.x, 8);
      expect(chain.nodes[0].y).toBeCloseTo(source.points[0][1] + carrier.y, 8);
      for (let i = 1; i < chain.nodes.length; i++) {
        const node = chain.nodes[i], previous = chain.nodes[i - 1];
        const rest = Math.hypot(source.points[i][0] - source.points[i - 1][0], source.points[i][1] - source.points[i - 1][1]);
        expect(Math.abs(Math.hypot(node.x - previous.x, node.y - previous.y) - rest)).toBeLessThan(.08);
        expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
      }
      const tip = chain.nodes.at(-1)!, rest = source.points.at(-1)!;
      if (Math.hypot(tip.x - rest[0], tip.y - rest[1]) > .25) movingTips++;
    }
    expect(movingTips).toBe(IDLE_CHAINS.length);
    expect(sampleSecondaryMotion(620, 490, rig.offsets)).toEqual({ x: 0, y: 0 });
  });
  test("30, 60 and 120 FPS produce the same fixed-step result; pause and reset are exact", () => {
    const rigs = [30, 60, 120].map(fps => { const rig = new IdleRig(); for (let i = 0; i < fps * 6; i++) rig.advance(1 / fps, .8); return rig; });
    for (let j = 1; j < rigs.length; j++) {
      for (let i = 0; i < rigs[0].offsets.length; i++) {
        expect(rigs[j].offsets[i].x).toBeCloseTo(rigs[0].offsets[i].x, 7);
        expect(rigs[j].offsets[i].y).toBeCloseTo(rigs[0].offsets[i].y, 7);
      }
    }
    const rig = rigs[0], saved = JSON.stringify(rig.offsets), time = rig.time;
    rig.advance(90, .2, false); expect(rig.time).toBe(time); expect(JSON.stringify(rig.offsets)).toBe(saved);
    rig.reset(); expect(rig.time).toBe(0); expect(rig.offsets.every(p => p.x === 0 && p.y === 0)).toBe(true);
    expect(CHARACTER_PLACEMENT.scale).toBeGreaterThan(.8);
  });
  test("after wind stops, tip movement settles rather than running an endless sine loop", () => {
    const rig = new IdleRig(); for (let i = 0; i < 180; i++) rig.advance(1 / 60, 1);
    for (let i = 0; i < 1200; i++) rig.advance(1 / 60, 0);
    const saved = rig.offsets.map(p => ({ ...p }));
    rig.advance(1 / 60, 0);
    const hairNodes = IDLE_CHAINS.slice(0, 2).reduce((n, c) => n + c.points.length, 0);
    expect(Math.max(...rig.offsets.slice(hairNodes).map((p, i) => Math.hypot(p.x - saved[i + hairNodes].x, p.y - saved[i + hairNodes].y)))).toBeLessThan(.001);
  });
});
