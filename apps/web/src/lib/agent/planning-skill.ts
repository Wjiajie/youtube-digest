import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

/** Fixed application-selected skill. User text cannot select files or versions. */
export async function loadPlanningSkill() {
  const instructions = await readFile(new URL("./skills/plan-path/v1/SKILL.md", import.meta.url), "utf8");
  return { instructions, identity: { name: "blueprint-plan-path", version: "1.0.0",
    sha256: createHash("sha256").update(instructions).digest("hex") } };
}
