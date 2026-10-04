# Shared version helpers for the product release and per-package bumps.
# Compatible with Windows PowerShell 5.1 and PowerShell 7.

$script:VersionElementNames = @(
    'Version',
    'ApplicationVersion',
    'ApplicationDisplayVersion',
    'AssemblyVersion',
    'FileVersion',
    'InformationalVersion',
    'LoggerVersion'
)

function ConvertTo-SemVer {
    param([Parameter(Mandatory)][string]$Version)

    $trimmed = $Version.Trim()
    if ($trimmed -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
        throw "Invalid semantic version '$Version'. Expected major.minor.patch."
    }

    return [pscustomobject]@{
        Major = [int]$Matches[1]
        Minor = [int]$Matches[2]
        Patch = [int]$Matches[3]
        Text  = $trimmed
    }
}

function Compare-SemVer {
    param(
        [Parameter(Mandatory)][string]$Left,
        [Parameter(Mandatory)][string]$Right
    )

    $a = ConvertTo-SemVer $Left
    $b = ConvertTo-SemVer $Right
    if ($a.Major -ne $b.Major) { return [Math]::Sign($a.Major - $b.Major) }
    if ($a.Minor -ne $b.Minor) { return [Math]::Sign($a.Minor - $b.Minor) }
    return [Math]::Sign($a.Patch - $b.Patch)
}

function Bump-SemVer {
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][ValidateSet('major', 'minor', 'patch')][string]$Part
    )

    $v = ConvertTo-SemVer $Version
    switch ($Part) {
        'major' { return '{0}.0.0' -f ($v.Major + 1) }
        'minor' { return '{0}.{1}.0' -f $v.Major, ($v.Minor + 1) }
        'patch' { return '{0}.{1}.{2}' -f $v.Major, $v.Minor, ($v.Patch + 1) }
    }
}

function Get-AndroidVersionCode {
    param([Parameter(Mandatory)][string]$Version)

    $v = ConvertTo-SemVer $Version
    if ($v.Major -gt 2000 -or $v.Minor -gt 999 -or $v.Patch -gt 999) {
        throw "Version $Version cannot be encoded as an Android versionCode. Minor and patch must be 0..999."
    }

    # 1.2.3 -> 1002003. versionCode must stay below Android's 2100000000 limit.
    return ($v.Major * 1000000) + ($v.Minor * 1000) + $v.Patch
}

function Get-FileVersion {
    param([Parameter(Mandatory)][string]$Version)
    $v = ConvertTo-SemVer $Version
    return '{0}.{1}.{2}.0' -f $v.Major, $v.Minor, $v.Patch
}

function Read-RepoText {
    param([Parameter(Mandatory)][string]$Path)

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $encoding = New-Object System.Text.UTF8Encoding $bom
    return [pscustomobject]@{
        Text = $encoding.GetString($bytes)
        Bom  = $bom
    }
}

function Write-RepoText {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][bool]$Bom
    )

    $encoding = New-Object System.Text.UTF8Encoding $Bom
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Get-XmlElementValue {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][string]$Name
    )

    $pattern = '<{0}>([^<]*)</{0}>' -f [regex]::Escape($Name)
    $match = [regex]::Match($Text, $pattern)
    if (-not $match.Success) { return $null }
    return $match.Groups[1].Value.Trim()
}

function Set-XmlElementValue {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Value
    )

    $pattern = '<{0}>[^<]*</{0}>' -f [regex]::Escape($Name)
    if ($Text -notmatch $pattern) {
        throw "Missing <$Name> element."
    }

    $replacement = '<{0}>{1}</{0}>' -f $Name, $Value
    return [regex]::Replace($Text, $pattern, $replacement, 1)
}

function Write-GitHubOutputValue {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Value
    )

    if (-not $env:GITHUB_OUTPUT) { return }
    $encoding = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::AppendAllText($env:GITHUB_OUTPUT, "$Name=$Value`n", $encoding)
}

function Get-LoggerVersion {
    param([Parameter(Mandatory)][string]$PropsPath)

    $text = (Read-RepoText $PropsPath).Text
    $version = Get-XmlElementValue $text 'LoggerVersion'
    if (-not $version) {
        throw "LoggerVersion was not found in $PropsPath."
    }
    return (ConvertTo-SemVer $version).Text
}

function Update-ProductVersionFiles {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][ValidateSet('major', 'minor', 'patch', 'none')][string]$Bump
    )

    $propsPath = Join-Path $RepoRoot 'Directory.Build.props'
    $props = Read-RepoText $propsPath
    $current = Get-XmlElementValue $props.Text 'LoggerVersion'
    if (-not $current) {
        throw "LoggerVersion was not found in $propsPath."
    }
    $current = (ConvertTo-SemVer $current).Text

    $next = $current
    if ($Bump -ne 'none') {
        $next = Bump-SemVer $current $Bump
        $updated = Set-XmlElementValue $props.Text 'LoggerVersion' $next
        Write-RepoText $propsPath $updated $props.Bom
    }

    $code = Get-AndroidVersionCode $next
    $androidProjects = @(Get-ChildItem -Path $RepoRoot -Filter '*.csproj' -Recurse -File | Where-Object {
            $_.FullName -notmatch '[\\/](bin|obj)[\\/]' -and
            (Select-String -Path $_.FullName -Pattern '<ApplicationDisplayVersion>' -Quiet)
        })

    foreach ($project in $androidProjects) {
        $file = Read-RepoText $project.FullName
        $text = Set-XmlElementValue $file.Text 'ApplicationDisplayVersion' $next
        $text = Set-XmlElementValue $text 'ApplicationVersion' ([string]$code)
        if ($text -ne $file.Text) {
            Write-RepoText $project.FullName $text $file.Bom
        }
    }

    return [pscustomobject]@{
        Previous    = $current
        Version     = $next
        VersionCode = $code
        Tag         = "v$next"
        Changed     = ($next -ne $current)
    }
}

function Get-Packages {
    param([Parameter(Mandatory)][string]$RepoRoot)

    $root = $RepoRoot.TrimEnd('\', '/')
    $packages = @()
    foreach ($dir in @(Get-ChildItem -Path $root -Directory)) {
        if ($dir.Name.StartsWith('.')) { continue }
        if ($dir.Name -like '*.Tests') { continue }
        $project = @(Get-ChildItem -Path $dir.FullName -Filter '*.csproj' -File) | Select-Object -First 1
        if (-not $project) { continue }

        $relative = $project.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
        $packages += [pscustomobject]@{
            Name             = $dir.Name
            Directory        = $dir.Name
            ProjectFile      = $project.FullName
            RelativeProject  = $relative
        }
    }
    return $packages
}

function Test-IgnoredPackagePath {
    param([Parameter(Mandatory)][string]$Path)
    $normalized = $Path.Replace('\', '/')
    return $normalized -match '(^|/)(bin|obj)/' -or $normalized -match '\.user$'
}

function Test-VersionOnlyDiffLine {
    param([Parameter(Mandatory)][string]$Line)
    if ($Line -notmatch '^[+-]') { return $false }
    if ($Line -match '^(\+\+\+|---)') { return $false }
    $names = ($script:VersionElementNames -join '|')
    return $Line -match ('^[+-]\s*<(' + $names + ')>.*</\1>\s*$')
}

function Invoke-Git {
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string[]]$GitArgs
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & git -C $Repo @GitArgs 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }

    $lines = @()
    if ($null -ne $output) {
        $lines = @($output | ForEach-Object { $_.ToString().TrimEnd("`r").Trim() } | Where-Object { $_ })
    }

    return [pscustomobject]@{
        Code  = $code
        Lines = $lines
    }
}

function Get-GitLines {
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string[]]$GitArgs
    )

    $result = Invoke-Git $Repo $GitArgs
    # git diff exits 1 when the compared trees differ.
    if ($result.Code -gt 1) {
        $detail = $result.Lines -join ' '
        throw "git $($GitArgs -join ' ') failed. $detail"
    }
    return @($result.Lines)
}

function Test-PackageContentChanged {
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)]$Package,
        [Parameter(Mandatory)][string[]]$ChangedFiles,
        [string]$DiffBase,
        [switch]$Cached
    )

    $prefix = $Package.Directory + '/'
    $relevant = @($ChangedFiles | Where-Object {
            $path = $_.Replace('\', '/')
            $path.StartsWith($prefix) -and -not (Test-IgnoredPackagePath $path)
        })
    if ($relevant.Count -eq 0) { return $false }

    $others = @($relevant | Where-Object { $_.Replace('\', '/') -ne $Package.RelativeProject })
    if ($others.Count -gt 0) { return $true }

    $diffArgs = @('diff', '-U0')
    if ($Cached) {
        $diffArgs += @('--cached', '--', $Package.RelativeProject)
    }
    else {
        $diffArgs += @($DiffBase, '--', $Package.RelativeProject)
    }

    $diff = Get-GitLines $Repo $diffArgs
    foreach ($line in $diff) {
        if ($line -match '^[+-]' -and $line -notmatch '^(\+\+\+|---)' -and -not (Test-VersionOnlyDiffLine $line)) {
            return $true
        }
    }
    return $false
}

function Get-PackageVersionText {
    param([Parameter(Mandatory)][string]$ProjectFile)
    if (-not (Test-Path $ProjectFile)) { return $null }
    return Get-XmlElementValue (Read-RepoText $ProjectFile).Text 'Version'
}

function Get-PackageVersionAtRevision {
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$Revision,
        [Parameter(Mandatory)][string]$RelativeProject
    )

    $result = Invoke-Git $Repo @('show', "${Revision}:${RelativeProject}")
    if ($result.Code -ne 0) { return $null }
    return Get-XmlElementValue ($result.Lines -join "`n") 'Version'
}

function Set-PackageVersion {
    param(
        [Parameter(Mandatory)][string]$ProjectFile,
        [Parameter(Mandatory)][string]$Version
    )

    $file = Read-RepoText $ProjectFile
    if ($null -eq (Get-XmlElementValue $file.Text 'Version')) {
        if ($file.Text -notmatch '<PropertyGroup>') {
            throw "Cannot add <Version> because $ProjectFile has no PropertyGroup."
        }
        $withVersion = [regex]::Replace(
            $file.Text,
            '<PropertyGroup>',
            "<PropertyGroup>`r`n    <Version>$Version</Version>",
            1)
        Write-RepoText $ProjectFile $withVersion $file.Bom
        return
    }

    $updated = Set-XmlElementValue $file.Text 'Version' $Version
    Write-RepoText $ProjectFile $updated $file.Bom
}

function Invoke-PackageVersionBump {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][ValidateSet('pre-commit', 'apply', 'check')][string]$Mode,
        [string]$BaseRef = '',
        [switch]$Stage
    )

    $repo = (Resolve-Path $RepoRoot).Path.TrimEnd('\', '/')
    $packages = @(Get-Packages $repo)
    $cached = $Mode -eq 'pre-commit'
    $diffBase = $null
    $revision = $null

    if ($cached) {
        $changed = @(Get-GitLines $repo @('diff', '--cached', '--name-only', '--diff-filter=ACMRD'))
        $revision = 'HEAD'
    }
    else {
        if (-not $BaseRef) { throw 'BaseRef is required for apply and check.' }
        $mergeBase = Invoke-Git $repo @('merge-base', $BaseRef, 'HEAD')
        if ($mergeBase.Code -ne 0) {
            throw "Could not find a merge base between '$BaseRef' and HEAD."
        }
        $revision = $mergeBase.Lines[0]
        $diffBase = "${revision}...HEAD"
        $changed = @(Get-GitLines $repo @('diff', '--name-only', '--diff-filter=ACMRD', $diffBase))
    }

    $changes = @()
    foreach ($package in $packages) {
        $contentChanged = Test-PackageContentChanged -Repo $repo -Package $package -ChangedFiles $changed -DiffBase $diffBase -Cached:$cached
        if (-not $contentChanged) { continue }

        if (-not (Test-Path $package.ProjectFile)) { continue }

        $baseVersion = Get-PackageVersionAtRevision $repo $revision $package.RelativeProject
        if (-not $baseVersion) {
            # The package is new in this change. Keep the version written in the project file.
            continue
        }
        $baseVersion = (ConvertTo-SemVer $baseVersion).Text

        $current = Get-PackageVersionText $package.ProjectFile
        if (-not $current) { $current = $baseVersion }
        else { $current = (ConvertTo-SemVer $current).Text }

        if ((Compare-SemVer $current $baseVersion) -gt 0) { continue }

        $from = $current
        if ((Compare-SemVer $current $baseVersion) -lt 0) { $from = $baseVersion }
        $next = Bump-SemVer $from 'patch'
        $changes += [pscustomobject]@{
            Name = $package.Name
            From = $current
            To   = $next
            Path = $package.RelativeProject
            File = $package.ProjectFile
        }
    }

    if ($Mode -eq 'check') {
        if ($changes.Count -gt 0) {
            $details = ($changes | ForEach-Object { "$($_.Name) $($_.From) -> $($_.To)" }) -join ', '
            throw "Package contents changed without a version bump: $details"
        }
        return
    }

    foreach ($change in $changes) {
        Set-PackageVersion $change.File $change.To
        Write-Host "$($change.Name) $($change.From) -> $($change.To)"
        if ($Stage -or $cached) {
            $added = Invoke-Git $repo @('add', '--', $change.Path)
            if ($added.Code -ne 0) { throw "git add $($change.Path) failed." }
        }
    }

    return $changes
}

function Resolve-ReleaseBump {
    param(
        [string]$PrHeadRef = '',
        [string]$CommitMessage = ''
    )

    $branch = ''
    if ($PrHeadRef) {
        $branch = $PrHeadRef.Trim()
    }
    elseif ($CommitMessage -match 'Merge pull request #\d+ from [^/\s]+/(\S+)') {
        $branch = $Matches[1].Trim()
    }
    elseif ($CommitMessage -match "Merge remote-tracking branch 'origin/([^']+)'") {
        $branch = $Matches[1].Trim()
    }
    elseif ($CommitMessage -match "Merge branch '([^']+)'") {
        $branch = $Matches[1].Trim()
    }

    if ($branch -eq 'dev') { return 'minor' }
    if ($branch -like 'hotfix/*' -or $branch -like 'hotfix-*') { return 'patch' }
    return 'skip'
}

function Get-HeadReleaseTag {
    param([Parameter(Mandatory)][string]$Repo)

    $tags = @(Get-GitLines $Repo @('tag', '--points-at', 'HEAD'))
    foreach ($tag in $tags) {
        if ($tag -match '^v\d+\.\d+\.\d+$') { return $tag }
    }
    return $null
}

function Test-AnyReleaseTag {
    param([Parameter(Mandatory)][string]$Repo)

    $tags = @(Get-GitLines $Repo @('tag', '-l', 'v*'))
    foreach ($tag in $tags) {
        if ($tag -match '^v\d+\.\d+\.\d+$') { return $true }
    }
    return $false
}

function Resolve-ReleaseAction {
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][ValidateSet('major', 'minor', 'patch')][string]$Bump
    )

    $head = (Invoke-Git $Repo @('rev-parse', 'HEAD')).Lines[0]
    $remote = $head
    $remoteCheck = Invoke-Git $Repo @('rev-parse', '--verify', '--quiet', 'origin/main')
    $remoteOk = $remoteCheck.Code -eq 0
    if ($remoteOk) {
        $remote = $remoteCheck.Lines[0]
    }

    $remoteSubject = (Invoke-Git $Repo @('log', '-1', '--pretty=%s', $remote)).Lines[0]
    $headIsRemote = $head -eq $remote
    $remoteRelease = $null
    if ($remoteSubject -match '^chore: release v(\d+\.\d+\.\d+)\b') {
        $remoteRelease = $Matches[1]
    }

    # A re-run checks out the original commit, while origin/main has moved to the release commit.
    if ($remoteOk -and -not $headIsRemote -and $remoteRelease) {
        $ancestor = Invoke-Git $Repo @('merge-base', '--is-ancestor', $head, $remote)
        if ($ancestor.Code -eq 0) {
            return New-ReuseRelease $remoteRelease
        }
    }

    # Pushing the release commit itself should not bump again. An explicit major bump may.
    if ($headIsRemote -and $remoteRelease -and $Bump -ne 'major') {
        return New-ReuseRelease $remoteRelease
    }

    $tag = Get-HeadReleaseTag $Repo
    $explicitMajorOnRelease = $Bump -eq 'major' -and $headIsRemote -and $remoteRelease
    if ($tag -and -not $explicitMajorOnRelease) {
        return New-ReuseRelease $tag.Substring(1)
    }

    $effective = $Bump
    if (-not (Test-AnyReleaseTag $Repo) -and $Bump -ne 'major') {
        $effective = 'none'
    }

    return [pscustomobject]@{
        Action        = 'prepare'
        EffectiveBump = $effective
    }
}

function New-ReuseRelease {
    param([Parameter(Mandatory)][string]$Version)
    $version = (ConvertTo-SemVer $Version).Text
    return [pscustomobject]@{
        Action        = 'reuse'
        EffectiveBump = 'none'
        Version       = $version
        VersionCode   = Get-AndroidVersionCode $version
        Tag           = "v$version"
    }
}
