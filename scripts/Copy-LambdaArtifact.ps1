param([Parameter(Mandatory)] [string] $SourcePath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = if ([IO.Path]::IsPathRooted($SourcePath)) { $SourcePath } else { Join-Path $projectRoot $SourcePath }
$source = [IO.Path]::GetFullPath($source)
$destination = Join-Path $projectRoot '.aws-build\loan-engine.zip'
$destinationDirectory = Split-Path -Parent $destination

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw 'The supplied Lambda ZIP was not found.'
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($source)
try {
    $entries = @($archive.Entries | ForEach-Object FullName)
    if ('app/lambda_handlers.py' -notin $entries -or 'migrations/003_upload_processing_lease.sql' -notin $entries) {
        throw 'The Lambda ZIP is missing required application files.'
    }
    if ($entries | Where-Object { $_ -match '(?i)(\.csv|\.docx|\.png)$' }) {
        throw 'The Lambda ZIP contains an input or image file.'
    }
}
finally {
    $archive.Dispose()
}

New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
if (-not [string]::Equals($source, [IO.Path]::GetFullPath($destination), [StringComparison]::OrdinalIgnoreCase)) {
    Copy-Item -LiteralPath $source -Destination $destination -Force
}
Write-Output 'Lambda artifact is ready.'
