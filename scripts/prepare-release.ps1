# Decide the product version for this main commit and update version files when needed.
param(
    [Parameter(Mandatory)]
    [ValidateSet('major', 'minor', 'patch')]
    [string]$Bump
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Versioning.ps1')

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repo

$origin = Invoke-Git $repo @('remote', 'get-url', 'origin')
if ($origin.Code -eq 0) {
    $fetch = Invoke-Git $repo @('fetch', 'origin', 'main', '--tags', '--force')
    if ($fetch.Code -ne 0) {
        throw "Could not fetch origin/main. $($fetch.Lines -join ' ')"
    }
}

$plan = Resolve-ReleaseAction -Repo $repo -Bump $Bump
if ($plan.Action -eq 'reuse') {
    Write-Host "reusing $($plan.Tag)"
    Write-GitHubOutputValue 'action' 'reuse'
    Write-GitHubOutputValue 'version' $plan.Version
    Write-GitHubOutputValue 'version_code' ([string]$plan.VersionCode)
    Write-GitHubOutputValue 'tag' $plan.Tag
    Write-GitHubOutputValue 'changed' 'false'
    exit 0
}

$result = Update-ProductVersionFiles -RepoRoot $repo -Bump $plan.EffectiveBump
Write-Host "product $($result.Previous) -> $($result.Version) ($($plan.EffectiveBump))"
Write-GitHubOutputValue 'action' 'prepare'
Write-GitHubOutputValue 'version' $result.Version
Write-GitHubOutputValue 'version_code' ([string]$result.VersionCode)
Write-GitHubOutputValue 'tag' $result.Tag
Write-GitHubOutputValue 'changed' $(if ($result.Changed) { 'true' } else { 'false' })
