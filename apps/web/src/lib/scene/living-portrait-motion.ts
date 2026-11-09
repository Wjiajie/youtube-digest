export const PORTRAIT_WIDTH = 1670;
export const PORTRAIT_HEIGHT = 941;
export type PortraitPointer = { x: number; y: number };
const bounded = (value: number, max = 1) => Number.isFinite(value) ? Math.max(-max, Math.min(max, value)) : 0;

export function advancePortraitTime(time: number, delta: number, active: boolean) {
  return active && Number.isFinite(delta) ? time + Math.max(0, Math.min(delta, 1 / 30)) : time;
}
export function layerOffset(layer: "background" | "foreground", pointer: PortraitPointer): PortraitPointer {
  const depth = layer === "foreground" ? 11 : -8;
  return { x: bounded(pointer.x) * depth || 0, y: bounded(pointer.y) * depth * -.45 || 0 };
}
export function stageFraming(width: number, height: number) {
  const scale = Math.max(width / PORTRAIT_WIDTH, height / PORTRAIT_HEIGHT) * 1.045;
  return { scale, x: (width - PORTRAIT_WIDTH * scale) * -.05 };
}
