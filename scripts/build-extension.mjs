import { build } from "esbuild";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
await build({
  entryPoints: [resolve(root, "blueprint-src.js")],
  outfile: resolve(root, "blueprint.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome116",
  minify: true,
  legalComments: "none",
});
