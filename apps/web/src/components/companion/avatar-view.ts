import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** Camera interaction owns no avatar state. The orbit target never pans. */
export function createAvatarView(
  camera: THREE.PerspectiveCamera,
  element: HTMLElement,
) {
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.zoomSpeed = 0.8;
  controls.minPolarAngle = Math.PI * 0.12;
  controls.maxPolarAngle = Math.PI * 0.88;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: undefined,
  };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  let fitDistance = 0;
  return {
    controls,
    fit(bounds: THREE.Box3, width: number, height: number, reservedBottom: number, reset = false) {
      if (!width || !height) return;
      const size = bounds.getSize(new THREE.Vector3());
      const target = bounds.getCenter(new THREE.Vector3());
      const reserve = Math.min(reservedBottom, height * 0.27);
      const usable = (height - reserve - 32) / height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const distance = Math.max(
        size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * usable),
        Math.max(size.x, size.y * 0.76) /
          (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect),
      ) * 1.08 + size.z * 0.5;
      const offset = camera.position.clone().sub(controls.target);
      const zoom = !reset && fitDistance ? offset.length() / fitDistance : 1;
      if (reset || !fitDistance) offset.set(0, 0, 1);
      // Keep the composer clear while retaining the user's orbit on resize.
      target.y -= size.y * (reserve / height) * 0.55;
      controls.target.copy(target);
      fitDistance = distance;
      controls.minDistance = distance * 0.28;
      controls.maxDistance = distance * 2;
      camera.position.copy(target).add(offset.normalize().multiplyScalar(
        THREE.MathUtils.clamp(zoom * distance, controls.minDistance, controls.maxDistance),
      ));
      controls.update();
    },
    update() { controls.update(); },
    dispose() { controls.dispose(); },
  };
}
