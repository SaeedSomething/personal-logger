# Bump <Version> in a project when files in that project directory changed.
#   pre-commit  staged changes since HEAD (used by the git hook)
#   apply       changes since -BaseRef (used by GitHub Actions)
#   check       fail if apply would bump anything
param(
    [Parameter(Mandatory)]
    [ValidateSet('pre-commit', 'apply', 'check')]
    [string]$Mode,

    [string]$BaseRef = '',

    [switch]$Stage
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Versioning.ps1')

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Invoke-PackageVersionBump -RepoRoot $repo -Mode $Mode -BaseRef $BaseRef -Stage:$Stage | Out-Null
