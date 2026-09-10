// Temporary, exact-version repair for Next's vendored compression drain proxy.
// Do not generalize across upgrades: re-run the HTTP regression and remove this
// patch when upstream handles listener removal on the actual registration target.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const originalHash = "8e7c2ec6982978c754c00388e0d1d3ff46d7aae99945d060f6f1052954c24e29";
const anchor = 'function nocompress(a){p("no compression: %s",a);';
const repair = `
/* Blueprint: Next 16.3.3 compression drain-removal repair. */
(function repairDrainRemoval() {
  const originalRemove = o.removeListener;
  function removeResponseListener(event, listener) {
    if (event !== "drain" || !d || typeof listener !== "function") {
      return originalRemove.call(this, event, listener);
    }
    if (x && x.rawListeners(event).some(candidate => candidate === listener || candidate.listener === listener)) {
      x.removeListener(event, listener);
      return this;
    } else if (!x) {
      // Before headers, compression buffers listeners for later transfer.
      // Match EventEmitter's last-registered removal and once-wrapper rules.
      for (let index = d.length - 1; index >= 0; index--) {
        if (d[index][0] === event && (d[index][1] === listener || d[index][1].listener === listener)) {
          d.splice(index, 1);
          return this;
        }
      }
    }
    // Listeners installed on the transport before compression remain there.
    return originalRemove.call(this, event, listener);
  }
  o.removeListener = removeResponseListener;
  o.off = removeResponseListener;
})();
`;

export function patchNextCompression(nextDirectory) {
  const version = JSON.parse(readFileSync(join(nextDirectory, "package.json"), "utf8")).version;
  assert.equal(version, "16.3.3", "Review/remove the compression repair before changing Next versions");
  const file = join(nextDirectory, "dist/compiled/compression/index.js");
  const source = readFileSync(file, "utf8");
  const occurrences = source.split(repair).length - 1;
  assert.ok(occurrences <= 1, "Duplicate compression repair; refusing to modify dependency");
  const original = occurrences ? source.replace(repair, "") : source;
  assert.equal(createHash("sha256").update(original).digest("hex"), originalHash,
    "Unexpected compression bytes; refusing to modify dependency");
  if (occurrences) return "already-patched";
  assert.equal(original.split(anchor).length - 1, 1);
  writeFileSync(file, original.replace(anchor, repair + anchor));
  return "patched";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const require = createRequire(import.meta.url);
  console.log("Next compression:", patchNextCompression(dirname(require.resolve("next/package.json"))));
}
