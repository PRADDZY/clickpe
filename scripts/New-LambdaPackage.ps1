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
    $webDistSource = Join-Path $projectRoot 'web\dist'
    if (-not (Test-Path -LiteralPath (Join-Path $webDistSource 'index.html') -PathType Leaf)) {
        throw 'Build the web console before packaging the Lambda application.'
    }
    $appTarget = Join-Path $packageRoot 'app'
    $migrationTarget = Join-Path $packageRoot 'migrations'
    $webDistTarget = Join-Path $packageRoot 'web\dist'
    New-Item -ItemType Directory -Force -Path $appTarget, $migrationTarget, $webDistTarget | Out-Null
    Copy-Item -Path (Join-Path $appSource '*') -Destination $appTarget -Recurse -Force
    Copy-Item -Path (Join-Path $migrationSource '*.sql') -Destination $migrationTarget -Force
    Copy-Item -Path (Join-Path $webDistSource '*') -Destination $webDistTarget -Recurse -Force
    Get-ChildItem -LiteralPath $packageRoot -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath $packageRoot -Recurse -File -Filter '*.pyc' | Remove-Item -Force

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archiveStream = [System.IO.File]::Open(
        $stagedZip,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
    $bundle = $null
    try {
        $bundle = [System.IO.Compression.ZipArchive]::new(
            $archiveStream,
            [System.IO.Compression.ZipArchiveMode]::Create
        )
        $stageLeaf = Split-Path -Leaf $packageStage
        foreach ($file in Get-ChildItem -LiteralPath $packageRoot -Recurse -File) {
            $fileParts = @($file.FullName -split '[\\/]')
            $stageIndex = [Array]::IndexOf($fileParts, $stageLeaf)
            if ($stageIndex -lt 0 -or [Array]::IndexOf($fileParts, $stageLeaf, [int]($stageIndex + 1)) -ge 0) {
                throw 'Could not resolve a file path relative to the Lambda package root.'
            }
            $packageIndex = $stageIndex + 1
            if ($packageIndex -ge $fileParts.Length -or $fileParts[$packageIndex] -cne 'package') {
                throw 'The Lambda package file is outside its expected root.'
            }
            $entryStart = $packageIndex + 1
            if ($entryStart -ge $fileParts.Length) { throw 'The Lambda archive contains an empty file path.' }
            $relativeParts = @($fileParts[$entryStart..($fileParts.Length - 1)])
            $entryName = [string]::Join('/', $relativeParts)
            if (-not $entryName -or $entryName.StartsWith('/') -or $entryName -match '(^|/)\.\.(/|$)') {
                throw 'The Lambda archive contains an unsafe ZIP path.'
            }
            $entry = $bundle.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
            $inputStream = $file.OpenRead()
            $entryStream = $entry.Open()
            try { $inputStream.CopyTo($entryStream) }
            finally {
                $entryStream.Dispose()
                $inputStream.Dispose()
            }
        }
    }
    finally {
        if ($bundle) { $bundle.Dispose() } else { $archiveStream.Dispose() }
    }

    $bundle = [System.IO.Compression.ZipFile]::OpenRead($stagedZip)
    try {
        if ($bundle.Entries | Where-Object { $_.FullName.Contains('\') }) {
            throw 'The Lambda archive contains non-portable ZIP paths.'
        }
        if (-not ($bundle.Entries | Where-Object { $_.FullName -ceq 'app/lambda_handlers.py' })) {
            throw 'The Lambda archive is missing its handler.'
        }
        if (-not ($bundle.Entries | Where-Object { $_.FullName -ceq 'web/dist/index.html' })) {
            throw 'The Lambda archive is missing the built console.'
        }
        if (-not ($bundle.Entries | Where-Object { $_.FullName -ceq 'migrations/003_upload_processing_lease.sql' })) {
            throw 'The Lambda archive is missing the latest migration.'
        }
    }
    finally { $bundle.Dispose() }

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
