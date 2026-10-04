# Install a git pre-commit hook that runs .githooks/pre-commit. Safe to run again.
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $repo '.githooks/pre-commit'
$destDir = Join-Path $repo '.git/hooks'
$dest = Join-Path $destDir 'pre-commit'

if (-not (Test-Path $source)) {
    throw "Hook source was not found: $source"
}
if (-not (Test-Path $destDir)) {
    throw "This folder is not a git checkout: $destDir"
}

$stub = @"
#!/bin/sh
repo=`$(git rev-parse --show-toplevel) || exit 1
exec "`$repo/.githooks/pre-commit"
"@
$encoding = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($dest, ($stub -replace "`r`n", "`n"), $encoding)
Write-Host "Installed $dest"
