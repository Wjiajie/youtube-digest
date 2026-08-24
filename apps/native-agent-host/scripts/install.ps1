param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\Blueprint\AgentHost"
)

$ErrorActionPreference = "Stop"
$StableExtensionId = "kipaapemlimhdkpcenelpjeccmnkninf"
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

$sourceRoot = $PSScriptRoot
$sourceExe = Join-Path $sourceRoot "blueprint-agent-host.exe"
if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
  throw "Missing packaged host executable: $sourceExe"
}

$checksumsPath = Join-Path $sourceRoot "SHA256SUMS"
if (-not (Test-Path -LiteralPath $checksumsPath -PathType Leaf)) {
  throw "Missing SHA256SUMS; refusing to install an unverifiable host package."
}
$expectedLine = Get-Content -LiteralPath $checksumsPath |
  Where-Object { $_ -match '^[0-9a-fA-F]{64}\s+blueprint-agent-host\.exe$' } |
  Select-Object -First 1
if (-not $expectedLine) {
  throw "SHA256SUMS does not contain blueprint-agent-host.exe."
}
$expectedHash = ($expectedLine -split '\s+')[0].ToLowerInvariant()
$actualHash = Get-Sha256 $sourceExe
if ($actualHash -ne $expectedHash) {
  throw "Blueprint Agent Host checksum verification failed."
}

$resolvedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$expectedBase = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Blueprint\AgentHost"))
$expectedPrefix = $expectedBase.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$isExpectedBase = $resolvedInstallRoot.Equals($expectedBase, [System.StringComparison]::OrdinalIgnoreCase)
$isExpectedChild = $resolvedInstallRoot.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)
if (-not ($isExpectedBase -or $isExpectedChild)) {
  throw "InstallRoot must stay within $expectedBase"
}

New-Item -ItemType Directory -Force -Path $resolvedInstallRoot | Out-Null
$installedExe = Join-Path $resolvedInstallRoot "blueprint-agent-host.exe"
Copy-Item -LiteralPath $sourceExe -Destination $installedExe -Force

$hostManifestPath = Join-Path $resolvedInstallRoot "com.blueprint.agent.json"
$hostManifest = [ordered]@{
  name = "com.blueprint.agent"
  description = "Blueprint local Pi Agent service"
  path = $installedExe
  type = "stdio"
  allowed_origins = @("chrome-extension://$StableExtensionId/")
}
$hostManifestJson = $hostManifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText(
  $hostManifestPath,
  $hostManifestJson,
  [System.Text.UTF8Encoding]::new($false)
)

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.blueprint.agent"
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $hostManifestPath

Write-Host "Blueprint Agent Host installed."
Write-Host "Extension ID: $StableExtensionId"
Write-Host "Host manifest: $hostManifestPath"
