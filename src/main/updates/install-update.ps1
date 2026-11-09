param([int]$WaitPid, [string]$ZipPath, [string]$TargetDir, [string]$ExePath, [string]$LogPath)
$ErrorActionPreference = 'Stop'
function Log([string]$Message) { try { "$(Get-Date -Format o) $Message" | Out-File -LiteralPath $LogPath -Append -Encoding utf8 } catch { } }
function Child([string]$Root, [string]$Name) {
  if ([IO.Path]::GetFileName($Name) -ne $Name -or $Name -in @('', '.', '..', 'data')) { throw 'Invalid update entry' }
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $resolved = [IO.Path]::GetFullPath((Join-Path $Root $Name))
  if (-not $resolved.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Update path escaped its root' }
  return $resolved
}
function RemoveChild([string]$Root, [string]$Name) {
  $resolved = Child $Root $Name
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
$backupRoot = $null
$extractRoot = $null
$moved = [Collections.Generic.List[string]]::new()
$installed = [Collections.Generic.List[string]]::new()
try {
  $TargetDir = [IO.Path]::GetFullPath($TargetDir).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ExePath)) -ne $TargetDir -or [IO.Path]::GetFileName($ExePath) -ne 'DeskWeek.exe') { throw 'Invalid application directory' }
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Application did not exit' }
    Start-Sleep -Milliseconds 500
  }
  Start-Sleep -Milliseconds 700
  $extractRoot = Join-Path $env:TEMP ('DeskWeek-update-' + [Guid]::NewGuid().ToString('N'))
  $backupRoot = Join-Path $env:TEMP ('DeskWeek-backup-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $extractRoot, $backupRoot | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $extractRoot)
  $source = Get-ChildItem -LiteralPath $extractRoot -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'DeskWeek.exe') } | Select-Object -First 1
  if (-not $source -and (Test-Path -LiteralPath (Join-Path $extractRoot 'DeskWeek.exe'))) { $source = Get-Item -LiteralPath $extractRoot }
  if (-not $source -or -not (Test-Path -LiteralPath (Join-Path $source.FullName 'resources\app.asar'))) { throw 'Invalid update package' }
  $newNames = @(Get-ChildItem -LiteralPath $source.FullName -Force | Where-Object { $_.Name -ne 'data' } | ForEach-Object { $_.Name })
  $manifest = Join-Path $TargetDir '.deskweek-files.json'
  $oldNames = @('DeskWeek.exe', 'resources', 'locales', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'ffmpeg.dll', 'icudtl.dat', 'libEGL.dll', 'libGLESv2.dll', 'LICENSE', 'LICENSES.chromium.html', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll', 'version', '.deskweek-files.json')
  if (Test-Path -LiteralPath $manifest) { $oldNames = @(Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json) }
  foreach ($name in $newNames) {
    $target = Child $TargetDir $name
    if ((Test-Path -LiteralPath $target) -and $name -notin $oldNames) { throw "Update would overwrite an unrelated file: $name" }
  }
  # Backup moves belong to the same transaction as installation. A partially
  # completed backup is restored by the catch block using only tracked names.
  foreach ($name in $oldNames) {
    $target = Child $TargetDir $name
    if (Test-Path -LiteralPath $target) {
      $destination = Child $backupRoot $name
      Move-Item -LiteralPath $target -Destination $destination -Force
      $moved.Add($name)
    }
  }
  foreach ($name in $newNames) {
    $sourcePath = Child $source.FullName $name
    $destination = Child $TargetDir $name
    $installed.Add($name)
    Copy-Item -LiteralPath $sourcePath -Destination $destination -Recurse -Force
  }
  $started = Start-Process -FilePath $ExePath -WorkingDirectory $TargetDir -PassThru
  Start-Sleep -Seconds 3
  if ($started.HasExited) { throw 'Updated application exited during startup' }
  Log 'Update installed; previous version retained in TEMP for recovery'
} catch {
  Log "Update failed: $($_.Exception.Message)"
  try {
    foreach ($name in $installed) { RemoveChild $TargetDir $name }
    foreach ($name in $moved) {
      $sourcePath = Child $backupRoot $name
      $destination = Child $TargetDir $name
      Move-Item -LiteralPath $sourcePath -Destination $destination -Force
    }
    if ($moved.Count -gt 0 -and (Test-Path -LiteralPath $ExePath)) { Start-Process -FilePath $ExePath -WorkingDirectory $TargetDir }
  } catch { Log "Rollback failed; recovery files: $backupRoot; $($_.Exception.Message)" }
}
