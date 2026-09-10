// Shared by the two actual local study renderers; never imported by the product.
export function readStudyLighting(userData, theme) {
  if (!["cyberpunk", "eastern"].includes(theme)) throw new Error("Unknown study theme");
  if (Object.hasOwn(userData, "blueprint_lighting")) {
    const profile = userData.blueprint_lighting;
    if (!profile || Array.isArray(profile) || Object.keys(profile).length !== 6 || profile.version !== 1
      || ![profile.environmentIntensity, profile.hemisphereIntensity, profile.exposure].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 5)
      || profile.exposure === 0 || ![profile.sky, profile.ground].every(value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value))) throw new Error("Invalid authored study lighting");
    return { ...profile };
  }
  return theme === "eastern"
    ? { version: 1, environmentIntensity: .35, hemisphereIntensity: 1.1, sky: "#E8EED8", ground: "#7A8980", exposure: 1.15 }
    : { version: 1, environmentIntensity: .6, hemisphereIntensity: .8, sky: "#AECBD4", ground: "#283A48", exposure: 1.15 };
}
