# Print major/minor/patch/skip for a push to main.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Versioning.ps1')

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repo

$subject = (Invoke-Git $repo @('log', '-1', '--pretty=%s')).Lines[0]
if ($subject -match '^chore: release v\d+\.\d+\.\d+\b' -or $subject -match '^chore: merge v\d+\.\d+\.\d+ into dev\b') {
    Write-Host 'skip'
    Write-GitHubOutputValue 'bump' 'skip'
    exit 0
}

$headRef = ''
if ($env:GITHUB_REPOSITORY -and (Get-Command gh -ErrorAction SilentlyContinue)) {
    $sha = (Invoke-Git $repo @('rev-parse', 'HEAD')).Lines[0]
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & gh api --header 'Accept: application/vnd.github.groot-preview+json' "repos/$env:GITHUB_REPOSITORY/commits/$sha/pulls" 2>&1
        $ghCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    if ($ghCode -eq 0) {
        $text = ($raw | Where-Object { $_ -is [string] }) -join "`n"
        if ($text) {
            $parsed = $text | ConvertFrom-Json
            $pulls = @($parsed | Where-Object { $_ -and $_.head -and $_.head.ref })
            if ($pulls.Count -gt 0) {
                $headRef = [string]$pulls[0].head.ref
            }
        }
    }
}

$message = (Invoke-Git $repo @('log', '-1', '--pretty=%B')).Lines -join "`n"
$bump = Resolve-ReleaseBump -PrHeadRef $headRef -CommitMessage $message
Write-Host $bump
Write-GitHubOutputValue 'bump' $bump
