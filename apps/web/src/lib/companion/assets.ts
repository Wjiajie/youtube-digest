import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import catalog from "./shayna-catalog.json";
const verified = new Map<string, { mtime: number; data: Buffer }>();
/** Exact audited files only; no arbitrary paths, proxy URLs or runtime conversion. */
export async function privateAsset(id: string) {
  const variant = catalog.variants.find((v) => v.id === id);
  if (!variant && id !== "idle") throw new Error("not_found");
  const directory =
    id === "idle"
      ? (process.env.SHAYNA_MOTION_DIR ??
        path.join(process.cwd(), "src/lib/companion/animations"))
      : process.env.SHAYNA_ASSET_DIR;
  if (!directory) throw new Error("asset_not_configured");
  const base = await realpath(/* turbopackIgnore: true */ directory),
    file = await realpath(
      /* turbopackIgnore: true */ path.resolve(
        base,
        variant?.file ?? "idle_loop.vrma",
      ),
    );
  const relative = path.relative(base, file);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("forbidden");
  const { stat } = await import("node:fs/promises");
  const info = await stat(/* turbopackIgnore: true */ file);
  const cache = verified.get(file);
  if (cache?.mtime === info.mtimeMs) return cache.data;
  const data = await readFile(/* turbopackIgnore: true */ file);
  const expectedHash =
    variant?.sha256 ??
    "ace95ba6dcc0bdf2ed1081c002332b4184441117c8d543b6f642b3d2c5cf99be";
  if (createHash("sha256").update(data).digest("hex") !== expectedHash)
    throw new Error("asset_hash_mismatch");
  verified.set(file, { mtime: info.mtimeMs, data });
  return data;
}
