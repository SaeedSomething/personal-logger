# Regression checks for product and package versioning. No network and no repo side effects.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Versioning.ps1')

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message. Expected [$Expected] but got [$Actual]."
    }
}

function Write-Utf8 {
    param([string]$Path, [string]$Text)
    $directory = Split-Path $Path -Parent
    if ($directory -and -not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory | Out-Null
    }
    $encoding = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function New-TestRepo {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ('pl-version-' + [guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    & git -C $dir init -q
    & git -C $dir config user.email "test@example.com"
    & git -C $dir config user.name "version test"
    & git -C $dir config commit.gpgsign false
    & git -C $dir config core.autocrlf false
    return $dir
}

function Invoke-GitCommit {
    param([string]$Repo, [string]$Message)
    & git -C $Repo add -- .
    if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }
    & git -C $Repo commit -q -m $Message
    if ($LASTEXITCODE -ne 0) { throw "git commit failed: $Message" }
}

function New-PackageProject {
    param([string]$Repo, [string]$Name, [string]$Version, [string]$Source)
    $csproj = @"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Version>$Version</Version>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Example.Lib" Version="2.1.12" />
  </ItemGroup>
</Project>
"@
    Write-Utf8 (Join-Path $Repo "$Name/$Name.csproj") $csproj
    Write-Utf8 (Join-Path $Repo "$Name/Lib.cs") $Source
}

Assert-Equal (Bump-SemVer '1.2.3' 'major') '2.0.0' 'major bump'
Assert-Equal (Bump-SemVer '1.2.3' 'minor') '1.3.0' 'minor bump'
Assert-Equal (Bump-SemVer '1.2.3' 'patch') '1.2.4' 'patch bump'
Assert-Equal (Get-AndroidVersionCode '1.2.3') 1002003 'android versionCode'
Assert-Equal (Get-FileVersion '1.2.3') '1.2.3.0' 'file version'
Assert-Equal (Compare-SemVer '1.2.1' '1.2.0') 1 'compare greater'
Assert-Equal (Compare-SemVer '1.2.0' '1.2.0') 0 'compare equal'
Assert-Equal (Resolve-ReleaseBump -PrHeadRef 'dev') 'minor' 'dev branch'
Assert-Equal (Resolve-ReleaseBump -CommitMessage "Merge pull request #4 from SaeedSomething/dev") 'minor' 'github dev merge'
Assert-Equal (Resolve-ReleaseBump -CommitMessage "Merge pull request #9 from SaeedSomething/hotfix/crash") 'patch' 'github hotfix merge'
Assert-Equal (Resolve-ReleaseBump -CommitMessage "Merge branch 'hotfix/crash' into main") 'patch' 'gitflow hotfix merge'
Assert-Equal (Resolve-ReleaseBump -CommitMessage "Merge branch 'feat/tray'") 'skip' 'feature merge'

$productRepo = Join-Path ([System.IO.Path]::GetTempPath()) ('pl-product-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $productRepo | Out-Null
Write-Utf8 (Join-Path $productRepo 'Directory.Build.props') @"
<Project>
  <PropertyGroup>
    <LoggerVersion>1.2.3</LoggerVersion>
  </PropertyGroup>
</Project>
"@
Write-Utf8 (Join-Path $productRepo 'Logger.Android/Logger.Android.csproj') @"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <Version>1.4.0</Version>
    <ApplicationVersion>1</ApplicationVersion>
    <ApplicationDisplayVersion>0.1</ApplicationDisplayVersion>
  </PropertyGroup>
</Project>
"@
$product = Update-ProductVersionFiles -RepoRoot $productRepo -Bump minor
Assert-Equal $product.Version '1.3.0' 'product minor'
Assert-Equal $product.VersionCode 1003000 'product android code'
$androidText = [System.IO.File]::ReadAllText((Join-Path $productRepo 'Logger.Android/Logger.Android.csproj'))
if ($androidText -notmatch '<Version>1.4.0</Version>') { throw 'Product bump changed the package version.' }
if ($androidText -notmatch '<ApplicationDisplayVersion>1.3.0</ApplicationDisplayVersion>') { throw 'Android display version was not updated.' }
if ($androidText -notmatch '<ApplicationVersion>1003000</ApplicationVersion>') { throw 'Android versionCode was not updated.' }
Remove-Item -Recurse -Force $productRepo

$repo = New-TestRepo
New-PackageProject $repo 'Logger.Core' '1.0.0' 'class Core { }'
Invoke-GitCommit $repo 'init'

Write-Utf8 (Join-Path $repo 'Logger.Core/Lib.cs') 'class Core { void Changed() {} }'
& git -C $repo add -- Logger.Core/Lib.cs
$bumped = @(Invoke-PackageVersionBump -RepoRoot $repo -Mode pre-commit)
Assert-Equal $bumped.Count 1 'pre-commit bump count'
Assert-Equal $bumped[0].To '1.0.1' 'pre-commit patch'
$coreText = [System.IO.File]::ReadAllText((Join-Path $repo 'Logger.Core/Logger.Core.csproj'))
if ($coreText -notmatch '<Version>1.0.1</Version>') { throw 'Package version was not written.' }
if ($coreText -notmatch 'Version="2.1.12"') { throw 'PackageReference version was rewritten.' }
Invoke-GitCommit $repo 'change core'

Write-Utf8 (Join-Path $repo 'Logger.Core/Lib.cs') 'class Core { void ChangedAgain() {} }'
$coreText = $coreText -replace '<Version>1.0.1</Version>', '<Version>1.2.0</Version>'
Write-Utf8 (Join-Path $repo 'Logger.Core/Logger.Core.csproj') $coreText
& git -C $repo add -- Logger.Core/Lib.cs Logger.Core/Logger.Core.csproj
$kept = @(Invoke-PackageVersionBump -RepoRoot $repo -Mode pre-commit)
Assert-Equal $kept.Count 0 'manual package bump is kept'
Invoke-GitCommit $repo 'manual minor'

Write-Utf8 (Join-Path $repo 'Logger.Core/bin/out.dll') 'binary'
& git -C $repo add -- Logger.Core/bin/out.dll
$ignored = @(Invoke-PackageVersionBump -RepoRoot $repo -Mode pre-commit)
Assert-Equal $ignored.Count 0 'bin output is ignored'
& git -C $repo reset -q HEAD -- Logger.Core/bin
Remove-Item -Recurse -Force (Join-Path $repo 'Logger.Core/bin')

$onlyVersion = [System.IO.File]::ReadAllText((Join-Path $repo 'Logger.Core/Logger.Core.csproj'))
$onlyVersion = $onlyVersion -replace '<Version>1.2.0</Version>', '<Version>1.2.1</Version>'
Write-Utf8 (Join-Path $repo 'Logger.Core/Logger.Core.csproj') $onlyVersion
& git -C $repo add -- Logger.Core/Logger.Core.csproj
$versionOnly = @(Invoke-PackageVersionBump -RepoRoot $repo -Mode pre-commit)
Assert-Equal $versionOnly.Count 0 'version-only edit is not bumped again'
Invoke-GitCommit $repo 'version only'

New-PackageProject $repo 'Logger.Windows' '1.0.0' 'class Win { }'
& git -C $repo add -- Logger.Windows
$newPackage = @(Invoke-PackageVersionBump -RepoRoot $repo -Mode pre-commit)
Assert-Equal $newPackage.Count 0 'new package keeps its initial version'
Invoke-GitCommit $repo 'add windows'

Write-Utf8 (Join-Path $repo 'Logger.Windows/Lib.cs') 'class Win { void Changed() {} }'
Invoke-GitCommit $repo 'change windows without version'
$applied = @(Invoke-PackageVersionBump -RepoRoot $repo -Mode apply -BaseRef 'HEAD~1')
Assert-Equal $applied.Count 1 'apply bumps the changed package once'
Assert-Equal $applied[0].Name 'Logger.Windows' 'apply package name'
Assert-Equal $applied[0].To '1.0.1' 'apply patch'
$again = @(Invoke-PackageVersionBump -RepoRoot $repo -Mode apply -BaseRef 'HEAD~1')
Assert-Equal $again.Count 0 'apply does not bump twice'

$planRepo = New-TestRepo
Write-Utf8 (Join-Path $planRepo 'note.txt') 'init'
Invoke-GitCommit $planRepo 'init'
$first = Resolve-ReleaseAction -Repo $planRepo -Bump minor
Assert-Equal $first.Action 'prepare' 'first release prepares'
Assert-Equal $first.EffectiveBump 'none' 'first release keeps the current version'

& git -C $planRepo tag 'v1.0.0'
$tagged = Resolve-ReleaseAction -Repo $planRepo -Bump minor
Assert-Equal $tagged.Action 'reuse' 'tagged head is reused'
Assert-Equal $tagged.Version '1.0.0' 'tagged version'

Write-Utf8 (Join-Path $planRepo 'note.txt') 'next'
Invoke-GitCommit $planRepo 'more work'
$second = Resolve-ReleaseAction -Repo $planRepo -Bump patch
Assert-Equal $second.Action 'prepare' 'later release prepares'
Assert-Equal $second.EffectiveBump 'patch' 'later hotfix bumps patch'

$remote = Join-Path ([System.IO.Path]::GetTempPath()) ('pl-remote-' + [guid]::NewGuid().ToString('n'))
& git -C $planRepo checkout -q -B main
Write-Utf8 (Join-Path $planRepo 'note.txt') 'released'
Invoke-GitCommit $planRepo 'chore: release v1.0.1'
& git -C $planRepo tag 'v1.0.1'
& git clone --bare -q $planRepo $remote
& git -C $planRepo remote add origin $remote
& git -C $planRepo fetch -q origin
& git -C $planRepo update-ref refs/remotes/origin/main refs/tags/v1.0.1
& git -C $planRepo checkout -q HEAD~1
$rerun = Resolve-ReleaseAction -Repo $planRepo -Bump minor
Assert-Equal $rerun.Action 'reuse' 're-run reuses the release commit'
Assert-Equal $rerun.Version '1.0.1' 're-run version'

& git -C $planRepo checkout -q main
$major = Resolve-ReleaseAction -Repo $planRepo -Bump major
Assert-Equal $major.Action 'prepare' 'explicit major bumps again'
Assert-Equal $major.EffectiveBump 'major' 'explicit major component'

Remove-Item -Recurse -Force $repo, $planRepo, $remote
Write-Host 'versioning tests passed'
