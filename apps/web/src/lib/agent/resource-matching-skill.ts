import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

/** Application-selected version; resource text cannot select a Skill or a file. */
export async function loadResourceMatchingSkill() {
  const instructions = await readFile(new URL("./skills/match-resources/v1/SKILL.md", import.meta.url), "utf8");
  return { instructions, identity: { name: "blueprint-match-resources" as const, version: "1.0.0",
    sha256: createHash("sha256").update(instructions).digest("hex") } };
}
