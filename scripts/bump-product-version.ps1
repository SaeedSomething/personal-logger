# Update the product version in Directory.Build.props and the Android version fields.
# -Bump none rewrites the Android version fields to match the current product version.
param(
    [Parameter(Mandatory)]
    [ValidateSet('major', 'minor', 'patch', 'none')]
    [string]$Bump
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Versioning.ps1')

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$result = Update-ProductVersionFiles -RepoRoot $repo -Bump $Bump

Write-Host "product $($result.Previous) -> $($result.Version) (android $($result.VersionCode))"
Write-GitHubOutputValue 'version' $result.Version
Write-GitHubOutputValue 'version_code' ([string]$result.VersionCode)
Write-GitHubOutputValue 'tag' $result.Tag
Write-GitHubOutputValue 'changed' $(if ($result.Changed) { 'true' } else { 'false' })
