import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
await mkdir(resolve(root, "dist"), { recursive: true });

await build({
  entryPoints: [resolve(root, "src/index.ts")],
  outfile: resolve(root, "dist/blueprint-agent-host.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  loader: { ".md": "text" },
  minify: true,
  sourcemap: false,
  legalComments: "none",
});
