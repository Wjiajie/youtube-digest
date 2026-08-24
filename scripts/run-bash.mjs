import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const script = process.argv[2];
if (!script) {
  process.stderr.write("Usage: node scripts/run-bash.mjs <script> [args...]\n");
  process.exit(2);
}

const candidates =
  process.platform === "win32"
    ? [
        resolve(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
        resolve(
          process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
          "Git",
          "bin",
          "bash.exe",
        ),
        resolve(process.env.LOCALAPPDATA || "", "Programs", "Git", "bin", "bash.exe"),
      ]
    : ["bash"];

const bash = candidates.find((candidate) => candidate === "bash" || existsSync(candidate));
if (!bash) {
  process.stderr.write(
    "Git Bash is required. Install Git for Windows, then rerun this command.\n",
  );
  process.exit(1);
}

const result = spawnSync(bash, [script, ...process.argv.slice(3)], {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write(`Unable to start Git Bash: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
