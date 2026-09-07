import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./setup-m1-cloud.sh", import.meta.url), "utf8");
const stageSource = source.slice(source.indexOf("TOTAL_STAGES=9"));
const stages = source.match(/^stage "/gm) ?? [];

assert.match(source, /^TOTAL_STAGES=9$/m);
assert.equal(stages.length, 9, "wizard must keep exactly nine confirmed stages");
assert.match(source, /EXTENSION_ID="kipaapemlimhdkpcenelpjeccmnkninf"/);
assert.match(source, /EXTENSION_REDIRECT_URI="https:\/\/\$\{EXTENSION_ID\}\.chromiumapp\.org\/oauth2"/);

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID",
  "WXT_PUBLIC_WEB_ORIGIN",
  "WXT_PUBLIC_SUPABASE_URL",
  "WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "WXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID",
]) {
  assert.match(source, new RegExp(`write_env ${key} `), `${key} must have an explicit destination`);
}

assert.doesNotMatch(stageSource, /write_env (?:SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD)/);
assert.doesNotMatch(stageSource, /set_secret [A-Z]/, "CI has no declared secret consumers");
assert.match(source, /functions deploy prepare-invited-login/);
assert.doesNotMatch(source, /write_env SUPABASE_SERVICE_ROLE_KEY/);

const confirmation = source.indexOf("确认把仓库中的 Supabase migrations 推送到该托管项目？");
const remotePush = source.indexOf("run_supabase db push --linked --password");
assert.ok(confirmation >= 0 && remotePush > confirmation, "remote migration must follow an explicit confirmation gate");

console.log("M1 cloud setup wizard contract verified.");
