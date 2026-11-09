import type { VRM } from "@pixiv/three-vrm";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
export function createWaveController(vrm: VRM): {
  duration: number;
  apply(time: number, opacity?: number): boolean;
};
export function configureShaynaRig(vrm: VRM): {
  setStable(value: boolean): void;
  calibrateCuffs(): void;
  readonly stable: boolean;
  garmentJoints: number;
  reversedConstraints: number;
};
export function createAppearance(
  gltf: GLTF,
  catalog: unknown,
): {
  rawShapes: Array<{ key: string; source: string; name: string }>;
  clothing: Record<string, { available: boolean; visible: boolean }>;
  hair: Record<string, number>;
  support(clip: any): { available: boolean; reason: string };
  resetFrame(): void;
  clearFace(preserveRaw?: boolean): void;
  choose(id: string, time: number): boolean;
  setClothing(id: string, value: boolean): boolean;
  setHair(id: string, value: number): boolean;
  setRaw(key: string, value: number): boolean;
  setAgentExpression(id: string, time: number, intensity: number, duration: number): boolean;
  setAgentRaw(key: string, value: number, time: number, duration: number): boolean;
  clearAgentExpression(): void;
  clearAgent(): void;
  rawValue(key: string): number;
  apply(time: number): void;
  reset(): void;
};
