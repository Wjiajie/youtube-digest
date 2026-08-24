#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
check_script="$script_dir/check-release.sh"
dist_dir="$repo_root/dist"

release_files=()
while IFS= read -r file; do
  [[ -n "$file" ]] && release_files+=("$file")
done < <("$check_script" --print-files)

if ((${#release_files[@]} == 0)); then
  printf 'Packaging failed: release allowlist is empty\n' >&2
  exit 1
fi

version="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.version)' "$repo_root/manifest.json")"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
  printf 'Packaging failed: unsafe manifest version: %s\n' "$version" >&2
  exit 1
fi

mkdir -p "$dist_dir"
temporary_dir="$(mktemp -d "$dist_dir/.blueprint-package.XXXXXX")"
temporary_zip="$temporary_dir/blueprint.zip"
output_zip="$dist_dir/blueprint-v$version.zip"

cleanup() {
  if [[ -f "$temporary_zip" ]]; then
    rm -f "$temporary_zip"
  fi
  if [[ -d "$temporary_dir" ]]; then
    rmdir "$temporary_dir" 2>/dev/null || true
  fi
}
trap cleanup EXIT

(
  cd "$repo_root"
  # Exclude platform-specific extra attributes so identical source files
  # produce the same archive checksum across repeated local builds.
  if command -v zip >/dev/null 2>&1; then
    zip -X -q "$temporary_zip" "${release_files[@]}"
  elif command -v powershell.exe >/dev/null 2>&1; then
    file_list="$(IFS=';'; printf '%s' "${release_files[*]}")"
    powershell.exe -NoProfile -ExecutionPolicy Bypass \
      -File "$script_dir/create-extension-zip.ps1" \
      -RepoRoot "$repo_root" \
      -OutputZip "$temporary_zip" \
      -FileList "$file_list"
  else
    printf 'Packaging failed: zip or Windows PowerShell is required\n' >&2
    exit 1
  fi
)

if unzip -Z1 "$temporary_zip" | grep -En '(^|/)(config\.js|\.DS_Store|\.git)(/|$)' >&2; then
  printf 'Packaging failed: a forbidden private path entered the ZIP\n' >&2
  exit 1
fi

mv -f "$temporary_zip" "$output_zip"
rmdir "$temporary_dir"
trap - EXIT

checksum="$(node -e 'const fs=require("fs");const crypto=require("crypto");const hash=crypto.createHash("sha256");hash.update(fs.readFileSync(process.argv[1]));process.stdout.write(hash.digest("hex"));' "$output_zip")"
printf 'Created %s\n' "$output_zip"
printf 'SHA-256: %s\n' "$checksum"
