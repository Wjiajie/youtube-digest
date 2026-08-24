param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [Parameter(Mandatory = $true)]
  [string]$OutputZip,
  [Parameter(Mandatory = $true)]
  [string]$FileList
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$resolvedRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputZip)
$Files = @($FileList -split ";" | Where-Object { $_ })
if ($Files.Count -eq 0) {
  throw "Release file list is empty"
}
$outputParent = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Force -Path $outputParent | Out-Null

$fileStream = [System.IO.File]::Open(
  $resolvedOutput,
  [System.IO.FileMode]::CreateNew,
  [System.IO.FileAccess]::ReadWrite,
  [System.IO.FileShare]::None
)
try {
  $archive = [System.IO.Compression.ZipArchive]::new(
    $fileStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false
  )
  try {
    foreach ($relativePath in $Files) {
      $sourcePath = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot $relativePath))
      $rootPrefix = $resolvedRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
      if (-not $sourcePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Release file escapes the repository root: $relativePath"
      }
      if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Release file is missing: $relativePath"
      }
      $entryName = $relativePath.Replace("\", "/")
      $entry = $archive.CreateEntry(
        $entryName,
        [System.IO.Compression.CompressionLevel]::Optimal
      )
      $entry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
      $input = [System.IO.File]::OpenRead($sourcePath)
      try {
        $output = $entry.Open()
        try {
          $input.CopyTo($output)
        } finally {
          $output.Dispose()
        }
      } finally {
        $input.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
} finally {
  $fileStream.Dispose()
}
