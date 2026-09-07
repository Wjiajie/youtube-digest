import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(import.meta.dirname, "../apps/extension/.output/chrome-mv3");
const manifest = JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "3.0.0");
assert.equal(manifest.minimum_chrome_version, "116");
const extensionId = createHash("sha256")
  .update(Buffer.from(manifest.key, "base64"))
  .digest("hex")
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (digit) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(digit, 16)));
assert.equal(extensionId, "kipaapemlimhdkpcenelpjeccmnkninf");
assert.deepEqual([...manifest.permissions].sort(), ["identity", "sidePanel", "storage", "tabs"].sort());
assert.equal(manifest.permissions.includes("nativeMessaging"), false);
assert.equal(manifest.permissions.includes("scripting"), false);
assert.equal(manifest.host_permissions.includes("https://www.youtube.com/*"), true);
assert.equal(manifest.host_permissions.some((permission) => /supabase\.co|127\.0\.0\.1:54321/.test(permission)), true);
assert.equal(manifest.host_permissions.some((permission) => /supadata|deepseek/i.test(permission)), false);

const files = await readdir(output, { recursive: true });
const text = (
  await Promise.all(
    files.filter((file) => /\.(?:js|json|html|css)$/.test(file)).map((file) => readFile(resolve(output, file), "utf8")),
  )
).join("\n");
assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY|sk-[A-Za-z0-9_-]{20,}|api\.deepseek\.com|api\.supadata\.ai/i);
assert.match(text, /code_challenge_method/);
assert.match(text, /S256/);
assert.match(text, /AUTH_STATE_MISMATCH/);
assert.match(text, /scope:`email/);
assert.doesNotMatch(text, /client_secret|openid email profile/i);

console.log("M1 extension security surface verified.");
