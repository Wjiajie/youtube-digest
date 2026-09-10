import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

/** Application-selected version; conversation text cannot select a Skill or a file. */
export async function loadClarificationSkill() {
  const instructions = await readFile(new URL("./skills/clarify-goal/v1/SKILL.md", import.meta.url), "utf8");
  return { instructions, identity: { name: "blueprint-clarify-goal" as const, version: "1.0.0",
    sha256: createHash("sha256").update(instructions).digest("hex") } };
}
