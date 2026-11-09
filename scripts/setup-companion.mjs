import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2];
if (!source)
  throw new Error(
    "Usage: npm run setup:companion -- <private Shayna_VRM directory> [--local]",
  );
const directory = await fs.realpath(source);
await fs.access(path.join(directory, "Shayna_VRM1.0.vrm"));
const target = path.join(root, "apps/web/.env.local");
let content = await fs.readFile(target, "utf8").catch(() => "");
const entries = {
  ...(process.argv.includes("--local")
    ? { BLUEPRINT_COMPANION_STORAGE: "local" }
    : {}),
  SHAYNA_ASSET_DIR: directory.replaceAll("\\", "/"),
  SHAYNA_MOTION_DIR: path
    .join(root, "apps/web/src/lib/companion/animations")
    .replaceAll("\\", "/"),
  COMPANION_WEB_ORIGIN: "http://127.0.0.1:3000",
  COMPANION_GATEWAY_URL: "ws://127.0.0.1:3191",
  COMPANION_GATEWAY_SECRET: randomBytes(32).toString("hex"),
  BLUEPRINT_COMPANION_ENABLED: "true",
  COMPANION_LOCAL_PREVIEW: "true",
};
for (const [name, value] of Object.entries(entries)) {
  if (
    name === "BLUEPRINT_COMPANION_STORAGE" &&
    new RegExp(`^${name}=`, "m").test(content)
  )
    content = content.replace(
      new RegExp(`^${name}=.*$`, "m"),
      `${name}=${JSON.stringify(value)}`,
    );
  else if (!new RegExp(`^${name}=`, "m").test(content))
    content += `\n${name}=${JSON.stringify(value)}`;
}
await fs.writeFile(target, content + "\n", { mode: 0o600 });
console.log(
  "Prepared private companion configuration in apps/web/.env.local. Existing credentials preserved; --local explicitly selects local storage. No provider keys created or displayed.",
);
