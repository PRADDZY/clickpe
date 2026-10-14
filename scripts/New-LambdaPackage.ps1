$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$requirements = Join-Path $projectRoot 'requirements.txt'
$artifactDirectory = Join-Path $projectRoot '.aws-build'
$artifact = Join-Path $artifactDirectory 'loan-engine.zip'
$packageStage = Join-Path $env:TEMP ("clickpe-lambda-" + [guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $packageStage 'package'
$stagedZip = Join-Path $env:TEMP ("clickpe-lambda-" + [guid]::NewGuid().ToString('N') + '.zip')

if (-not (Test-Path -LiteralPath $requirements -PathType Leaf)) {
    throw 'Export the locked Python runtime dependencies before packaging.'
}

$resolvedArtifactDirectory = [IO.Path]::GetFullPath($artifactDirectory)
$resolvedArtifact = [IO.Path]::GetFullPath($artifact)
if (-not $resolvedArtifact.StartsWith($resolvedArtifactDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The Lambda artifact path must stay inside .aws-build.'
}
$resolvedTempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($temporaryPath in @($packageStage, $stagedZip)) {
    if (-not [IO.Path]::GetFullPath($temporaryPath).StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Temporary Lambda build paths must stay inside the system temp directory.'
    }
}

try {
    New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
    & uv pip install --target $packageRoot --python-platform x86_64-manylinux_2_17 --python-version 3.12 --only-binary ':all:' --requirements $requirements
    if ($LASTEXITCODE -ne 0) { throw 'Could not install Python wheels for the Lambda runtime.' }

    $appSource = Join-Path $projectRoot 'app'
    $migrationSource = Join-Path $projectRoot 'migrations'
    $appTarget = Join-Path $packageRoot 'app'
    $migrationTarget = Join-Path $packageRoot 'migrations'
    New-Item -ItemType Directory -Force -Path $appTarget, $migrationTarget | Out-Null
    Copy-Item -Path (Join-Path $appSource '*') -Destination $appTarget -Recurse -Force
    Copy-Item -Path (Join-Path $migrationSource '*.sql') -Destination $migrationTarget -Force
    Get-ChildItem -LiteralPath $packageRoot -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath $packageRoot -Recurse -File -Filter '*.pyc' | Remove-Item -Force

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory(
        $packageRoot,
        $stagedZip,
        [IO.Compression.CompressionLevel]::Optimal,
        $false
    )
    New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
    Move-Item -LiteralPath $stagedZip -Destination $artifact -Force
    $sizeMb = [math]::Round((Get-Item -LiteralPath $artifact).Length / 1MB, 1)
    Write-Output ("Built Linux Python 3.12 Lambda package ({0} MiB)." -f $sizeMb)
}
finally {
    if (Test-Path -LiteralPath $packageStage) {
        Remove-Item -LiteralPath $packageStage -Recurse -Force
    }
    if (Test-Path -LiteralPath $stagedZip) {
        Remove-Item -LiteralPath $stagedZip -Force
    }
}
