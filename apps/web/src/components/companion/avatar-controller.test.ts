// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { defaultPreferences } from "@/lib/companion/contracts";
import { createAvatarController } from "./avatar-controller";

const mocks = vi.hoisted(() => ({ load: vi.fn(), setRaw: vi.fn(), clearFace: vi.fn(), clearAgent: vi.fn(), clearAgentExpression: vi.fn() }));
vi.mock("three", async (original) => {
  const actual = await original<typeof import("three")>();
  return { ...actual, WebGLRenderer: class {
    domElement = document.createElement("canvas");
    setPixelRatio() {} setSize() {} dispose() {} render() {}
  } };
});
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({ GLTFLoader: class {
  register() {} loadAsync(url: string) { return mocks.load(url); }
} }));
vi.mock("@pixiv/three-vrm", () => ({ VRMLoaderPlugin: class {}, VRMUtils: { rotateVRM0() {}, deepDispose() {} } }));
vi.mock("@pixiv/three-vrm-animation", () => ({ VRMAnimationLoaderPlugin: class {}, createVRMAnimationClip: vi.fn() }));
vi.mock("./avatar-view", () => ({ createAvatarView: () => ({ fit() {}, update() {}, dispose() {}, controls: { target: new THREE.Vector3(), minDistance: 1, maxDistance: 10 } }) }));
vi.mock("./shayna-rig.mjs", () => ({
  configureShaynaRig: () => ({ calibrateCuffs() {} }), createWaveController: () => ({ duration: 4, apply() {} }),
  createAppearance: () => ({ rawShapes: [{ key: "Face::smile", name: "smile" }, { key: "Face::あ", name: "あ" }],
    clothing: { coat: { available: true, visible: true }, missing: { available: false, visible: false } },
    support: () => ({ available: false, reason: "not available" }), reset() {}, resetFrame() {}, apply() {},
    setClothing: () => true, setHair: () => true, setRaw() {}, clearFace: mocks.clearFace, clearAgent: mocks.clearAgent,
    clearAgentExpression: mocks.clearAgentExpression, setAgentRaw: mocks.setRaw, setAgentExpression: () => true })
}));
function model() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
  return { scene, userData: { vrm: { scene, meta: { metaVersion: "1" },
    humanoid: { getNormalizedBoneNode: () => null }, expressionManager: { expressions: [], getExpression: (id: string) => id === "happy" ? {} : null, setValue() {} }, update() {} } } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.setRaw.mockReturnValue(true);
  mocks.load.mockImplementation((url: string) => Promise.resolve(url.includes("id=idle") ? { userData: {} } : model()));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
});
it("exposes only current model controls, rejects stale and invalid calls, and revokes them across loading and failure", async () => {
  const controller = createAvatarController(document.createElement("div"), () => {});
  expect(controller.getAgentCapabilities()).toBeNull();
  await controller.setAppearance({ ...defaultPreferences, variant: "shayna-vrm1" });
  const first = controller.getAgentCapabilities()!;
  expect(first.controls).toContainEqual({ kind: "expression", id: "happy", label: "开心" });
  expect(first.controls.some((c) => c.id === "Face::あ" || c.id === "missing" || c.id === "sad")).toBe(false);
  controller.setTurn(2);
  const raw = { revision: first.revision, kind: "raw" as const, id: "Face::smile", value: 0.8, duration: 2 };
  expect(controller.applyAgentControl(raw, 1)).toBe(false);
  expect(controller.applyAgentControl({ ...raw, id: "Face::あ" }, 2)).toBe(false);
  expect(controller.applyAgentControl({ ...raw, duration: 30 }, 2)).toBe(false);
  expect(controller.applyAgentControl(raw, 2)).toBe(true);
  expect(mocks.setRaw).toHaveBeenCalledWith("Face::smile", 0.8, expect.any(Number), 2);
  expect(controller.applyAgentControl({ revision: first.revision, kind: "expression", id: "happy", value: 0.6 }, 2)).toBe(true);
  expect(mocks.clearAgentExpression).toHaveBeenCalled();
  let resolve!: (value: unknown) => void;
  mocks.load.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  const pending = controller.setAppearance({ ...defaultPreferences, variant: "shayna-short" });
  expect(controller.getAgentCapabilities()).toBeNull();
  expect(controller.applyAgentControl(raw, 2)).toBe(false);
  resolve(model());
  await pending;
  expect(controller.getAgentCapabilities()!.revision).not.toBe(first.revision);
  expect(controller.applyAgentControl(raw, 2)).toBe(false);
  mocks.load.mockRejectedValueOnce(new Error("failed"));
  await expect(controller.setAppearance({ ...defaultPreferences, variant: "shayna-vrm0" })).rejects.toThrow("failed");
  expect(controller.getAgentCapabilities()).toBeNull();
  controller.dispose();
  expect(controller.getAgentCapabilities()).toBeNull();
});
