param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\Blueprint\AgentHost"
)

$ErrorActionPreference = "Stop"
$resolvedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$expectedBase = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Blueprint\AgentHost"))
$expectedPrefix = $expectedBase.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$isExpectedBase = $resolvedInstallRoot.Equals($expectedBase, [System.StringComparison]::OrdinalIgnoreCase)
$isExpectedChild = $resolvedInstallRoot.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)
if (-not ($isExpectedBase -or $isExpectedChild)) {
  throw "InstallRoot must stay within $expectedBase"
}

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.blueprint.agent"
if (Test-Path -LiteralPath $registryPath) {
  Remove-Item -LiteralPath $registryPath -Force
}
if (Test-Path -LiteralPath $resolvedInstallRoot) {
  Remove-Item -LiteralPath $resolvedInstallRoot -Recurse -Force
}
Write-Host "Blueprint Agent Host removed. Browser extension data was not changed."
