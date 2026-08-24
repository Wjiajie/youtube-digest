$ErrorActionPreference = "Stop"
$StableExtensionId = "kipaapemlimhdkpcenelpjeccmnkninf"
$NodeVersion = "22.23.2"
$NodeArchiveHash = "1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97"
function Get-Sha256([string]$Path) {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      $hashBytes = $sha256.ComputeHash($stream)
    } finally {
      $stream.Dispose()
    }
  } finally {
    $sha256.Dispose()
  }
  return -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
}
$hostRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $hostRoot "..\.."))
$toolRoot = Join-Path $repoRoot ".tools\node-v$NodeVersion-win-x64"
$NodeExe = Join-Path $toolRoot "node.exe"
$archive = Join-Path $repoRoot "dist\node-v$NodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"

$downloadRequired = -not (Test-Path -LiteralPath $archive -PathType Leaf)
if (-not $downloadRequired) {
  $cachedHash = Get-Sha256 $archive
  if ($cachedHash -ne $NodeArchiveHash) {
    Write-Host "Cached Node.js archive is incomplete or invalid; downloading a clean copy."
    $downloadRequired = $true
  }
}
if ($downloadRequired) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $archive) | Out-Null
  Write-Host "Downloading pinned Node.js $NodeVersion runtime..."
  $temporaryArchive = "$archive.download"
  if (Test-Path -LiteralPath $temporaryArchive) {
    Remove-Item -LiteralPath $temporaryArchive -Force
  }
  & curl.exe --fail --location --retry 3 --retry-all-errors --retry-delay 1 --output $temporaryArchive $nodeUrl
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path -LiteralPath $temporaryArchive) { Remove-Item -LiteralPath $temporaryArchive -Force }
    throw "Pinned Node.js runtime download failed."
  }
  $downloadHash = Get-Sha256 $temporaryArchive
  if ($downloadHash -ne $NodeArchiveHash) {
    Remove-Item -LiteralPath $temporaryArchive -Force
    throw "Downloaded Node.js archive checksum verification failed."
  }
  Move-Item -LiteralPath $temporaryArchive -Destination $archive -Force
}
$actualArchiveHash = Get-Sha256 $archive
if ($actualArchiveHash -ne $NodeArchiveHash) {
  throw "Pinned Node.js archive checksum verification failed."
}
$toolsBase = Join-Path $repoRoot ".tools"
New-Item -ItemType Directory -Force -Path $toolsBase | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $toolsBase -Force

$version = & $NodeExe --version
if ($LASTEXITCODE -ne 0 -or $version -ne "v$NodeVersion") {
  throw "Blueprint Agent Host packaging requires Node v$NodeVersion; found $version"
}

Push-Location $repoRoot
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
  npm run build:host
  if ($LASTEXITCODE -ne 0) { throw "Host build failed." }
  Push-Location $hostRoot
  try {
    & $NodeExe --experimental-sea-config sea-config.json
    if ($LASTEXITCODE -ne 0) { throw "Node SEA blob generation failed." }

    $releaseRoot = Join-Path $repoRoot "dist\blueprint-agent-host-windows-x64"
    New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
    $releaseExe = Join-Path $releaseRoot "blueprint-agent-host.exe"
    Copy-Item -LiteralPath $NodeExe -Destination $releaseExe -Force

    & (Join-Path $repoRoot "node_modules\.bin\postject.cmd") $releaseExe NODE_SEA_BLOB (Join-Path $hostRoot "dist\blueprint-agent-host.blob") --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
    if ($LASTEXITCODE -ne 0) { throw "Node SEA injection failed." }

    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "install.ps1") -Destination $releaseRoot -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "uninstall.ps1") -Destination $releaseRoot -Force
    $manifest = [ordered]@{
      name = "com.blueprint.agent"
      description = "Blueprint local Pi Agent service"
      path = "%LOCALAPPDATA%\Blueprint\AgentHost\blueprint-agent-host.exe"
      type = "stdio"
      allowed_origins = @("chrome-extension://$StableExtensionId/")
    }
    $manifestPath = Join-Path $releaseRoot "com.blueprint.agent.example.json"
    $manifestJson = $manifest | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText(
      $manifestPath,
      $manifestJson,
      [System.Text.UTF8Encoding]::new($false)
    )

    $provenance = [ordered]@{
      node_version = $NodeVersion
      node_archive_sha256 = $NodeArchiveHash
      package_lock_sha256 = Get-Sha256 (Join-Path $repoRoot "package-lock.json")
      extension_id = $StableExtensionId
    }
    [System.IO.File]::WriteAllText(
      (Join-Path $releaseRoot "BUILD-PROVENANCE.json"),
      ($provenance | ConvertTo-Json -Depth 4),
      [System.Text.UTF8Encoding]::new($false)
    )
    $checksumFiles = @(
      "blueprint-agent-host.exe",
      "install.ps1",
      "uninstall.ps1",
      "com.blueprint.agent.example.json",
      "BUILD-PROVENANCE.json"
    )
    $checksumLines = foreach ($fileName in $checksumFiles) {
      $hash = Get-Sha256 (Join-Path $releaseRoot $fileName)
      "$hash  $fileName"
    }
    $checksumLines | Set-Content -LiteralPath (Join-Path $releaseRoot "SHA256SUMS") -Encoding ascii
    Write-Host "Created $releaseRoot"
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}
