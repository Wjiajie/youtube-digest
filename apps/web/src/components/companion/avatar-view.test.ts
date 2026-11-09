// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createAvatarView } from "./avatar-view";

const views: Array<ReturnType<typeof createAvatarView>> = [];
const bounds = () => new THREE.Box3(
  new THREE.Vector3(-0.5, 0, -0.3),
  new THREE.Vector3(0.5, 1.7, 0.3),
);

function setup() {
  const element = document.createElement("canvas");
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 1200 },
    clientHeight: { configurable: true, value: 800 },
    setPointerCapture: { value: vi.fn() },
    releasePointerCapture: { value: vi.fn() },
  });
  document.body.append(element);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.02, 50);
  const view = createAvatarView(camera, element);
  views.push(view);
  view.fit(bounds(), 1200, 800, 160);
  return { element, camera, view, controls: view.controls };
}

function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  options: { button?: number; shiftKey?: boolean; pointerId?: number; pointerType?: string } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: options.button ?? 0,
    shiftKey: options.shiftKey ?? false,
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    pointerType: { value: options.pointerType ?? "mouse" },
  });
  target.dispatchEvent(event);
}

function drag(
  element: HTMLElement,
  dx: number,
  dy: number,
  options: { button?: number; shiftKey?: boolean } = {},
) {
  pointer(element, "pointerdown", 400, 300, options);
  pointer(document, "pointermove", 400 + dx, 300 + dy, options);
  pointer(document, "pointerup", 400 + dx, 300 + dy, options);
}

function wheel(element: HTMLElement, deltaY: number) {
  element.dispatchEvent(new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY,
    clientX: 400,
    clientY: 300,
  }));
}

function settle(view: ReturnType<typeof createAvatarView>) {
  // Exercise the public animation hook until OrbitControls damping has settled.
  for (let frame = 0; frame < 600; frame++) view.update();
}

afterEach(() => {
  for (const view of views) view.dispose();
  views.length = 0;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("avatar camera interaction without a WebGL renderer", () => {
  it("allows damped rotation and zoom while disabling every pan mapping", () => {
    const { camera, controls } = setup();
    expect(controls.enableRotate).toBe(true);
    expect(controls.enableZoom).toBe(true);
    expect(controls.enableDamping).toBe(true);
    expect(controls.enablePan).toBe(false);
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    expect(controls.mouseButtons.MIDDLE).toBe(THREE.MOUSE.DOLLY);
    expect(controls.mouseButtons.RIGHT).toBeUndefined();
    expect(controls.touches.ONE).toBe(THREE.TOUCH.ROTATE);
    expect(controls.touches.TWO).toBe(THREE.TOUCH.DOLLY_ROTATE);
    const distance = camera.position.distanceTo(controls.target);
    expect(controls.minDistance).toBeCloseTo(distance * 0.28, 8);
    expect(controls.maxDistance).toBeCloseTo(distance * 2, 8);
    expect(controls.minPolarAngle).toBeCloseTo(Math.PI * 0.12, 8);
    expect(controls.maxPolarAngle).toBeCloseTo(Math.PI * 0.88, 8);
    expect(camera.aspect).toBe(1.5);
  });

  it("rotates with left drag and zooms with the wheel around a fixed target", () => {
    const { element, camera, view, controls } = setup();
    const target = controls.target.clone();
    const initialPosition = camera.position.clone();
    const initialDistance = camera.position.distanceTo(target);
    drag(element, 100, 35);
    settle(view);
    expect(camera.position.distanceTo(initialPosition)).toBeGreaterThan(0.1);
    expect(camera.position.distanceTo(target)).toBeCloseTo(initialDistance, 7);
    expect(controls.target.distanceTo(target)).toBeLessThan(1e-10);
    wheel(element, -120);
    settle(view);
    expect(camera.position.distanceTo(target)).toBeLessThan(initialDistance);
    expect(controls.target.distanceTo(target)).toBeLessThan(1e-10);
  });

  it.each([
    { label: "right drag", button: 2, shiftKey: false },
    { label: "Shift left drag", button: 0, shiftKey: true },
    { label: "Shift right drag", button: 2, shiftKey: true },
  ])("does not move the target during $label", ({ button, shiftKey }) => {
    const { element, view, controls } = setup();
    const target = controls.target.clone();
    drag(element, 180, 90, { button, shiftKey });
    settle(view);
    expect(controls.target.distanceTo(target)).toBeLessThan(1e-10);
  });

  it("uses a two finger gesture to dolly and rotate without translating the target", () => {
    const { element, camera, view, controls } = setup();
    const target = controls.target.clone();
    const initialDistance = camera.position.distanceTo(target);
    const initialAngle = controls.getAzimuthalAngle();
    pointer(element, "pointerdown", 300, 300, { pointerId: 1, pointerType: "touch" });
    pointer(element, "pointerdown", 500, 300, { pointerId: 2, pointerType: "touch" });
    pointer(document, "pointermove", 250, 330, { pointerId: 1, pointerType: "touch" });
    pointer(document, "pointermove", 600, 350, { pointerId: 2, pointerType: "touch" });
    pointer(document, "pointerup", 250, 330, { pointerId: 1, pointerType: "touch" });
    pointer(document, "pointerup", 600, 350, { pointerId: 2, pointerType: "touch" });
    settle(view);
    expect(camera.position.distanceTo(target)).toBeLessThan(initialDistance);
    expect(Math.abs(controls.getAzimuthalAngle() - initialAngle)).toBeGreaterThan(0.01);
    expect(controls.target.distanceTo(target)).toBeLessThan(1e-10);
  });

  it("preserves the user's angles and relative zoom when fitting a resized viewport", () => {
    const { element, camera, view, controls } = setup();
    const previousFitDistance = camera.position.distanceTo(controls.target);
    drag(element, 120, 40);
    wheel(element, -180);
    settle(view);
    const azimuth = controls.getAzimuthalAngle();
    const polar = controls.getPolarAngle();
    const zoomRatio = camera.position.distanceTo(controls.target) / previousFitDistance;
    const reference = setup();
    reference.view.fit(bounds(), 390, 844, 160, true);
    const resizedFitDistance = reference.camera.position.distanceTo(reference.controls.target);
    view.fit(bounds(), 390, 844, 160);
    settle(view);
    expect(camera.aspect).toBeCloseTo(390 / 844, 10);
    expect(controls.getAzimuthalAngle()).toBeCloseTo(azimuth, 7);
    expect(controls.getPolarAngle()).toBeCloseTo(polar, 7);
    expect(camera.position.distanceTo(controls.target) / resizedFitDistance).toBeCloseTo(zoomRatio, 7);
    expect(controls.minDistance).toBeCloseTo(resizedFitDistance * 0.28, 7);
    expect(controls.maxDistance).toBeCloseTo(resizedFitDistance * 2, 7);
    view.fit(bounds(), 390, 844, 160, true);
    settle(view);
    expect(camera.position.distanceTo(reference.camera.position)).toBeLessThan(1e-7);
    expect(controls.target.distanceTo(reference.controls.target)).toBeLessThan(1e-10);
  });

  it("clamps zoom to the configured distance range", () => {
    const { element, camera, view, controls } = setup();
    for (let step = 0; step < 100; step++) wheel(element, -120);
    settle(view);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(controls.minDistance, 7);
    for (let step = 0; step < 150; step++) wheel(element, 120);
    settle(view);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(controls.maxDistance, 7);
  });

  it("disconnects element and active pointer listeners so disposed views ignore input", () => {
    const { element, camera, view, controls } = setup();
    const removeElement = vi.spyOn(element, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    pointer(element, "pointerdown", 400, 300);
    view.dispose();
    const elementEvents = removeElement.mock.calls.map(([event]) => event);
    const documentEvents = removeDocument.mock.calls.map(([event]) => event);
    expect(elementEvents).toEqual(expect.arrayContaining(["pointerdown", "wheel", "contextmenu"]));
    expect(documentEvents).toEqual(expect.arrayContaining(["pointermove", "pointerup"]));
    const position = camera.position.clone();
    const target = controls.target.clone();
    drag(element, 150, 60);
    wheel(element, -200);
    settle(view);
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-10);
    expect(controls.target.distanceTo(target)).toBeLessThan(1e-10);
  });
});
