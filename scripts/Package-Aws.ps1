$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverlessCli = Join-Path $projectRoot 'node_modules\.bin\serverless.cmd'
. (Join-Path $PSScriptRoot 'Invoke-ClickPeServerless.ps1')
Push-Location $projectRoot
try {
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv before packaging the AWS functions.' }
    if (-not (Test-Path -LiteralPath $serverlessCli)) {
        throw 'Run npm ci at the project root before packaging the AWS functions.'
    }
    & uv export --locked --no-dev --no-hashes --no-emit-project --format requirements.txt --output-file requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Could not export the locked Python runtime dependencies.' }
    if ($LambdaArtifactPath) {
        & (Join-Path $PSScriptRoot 'Copy-LambdaArtifact.ps1') -SourcePath $LambdaArtifactPath
        if ($LASTEXITCODE -ne 0) { throw 'Could not stage the Linux Lambda package.' }
    } else {
        & (Join-Path $PSScriptRoot 'New-LambdaPackage.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Could not build the Linux Lambda package.' }
    }
    Invoke-ClickPeServerless -CliPath $serverlessCli -AwsProfile $AwsProfile -Arguments @('package', '--stage', 'demo')
    Write-Output 'AWS deployment package is ready in .serverless.'
}
finally { Pop-Location }
param([string] $AwsProfile = 'dpratik', [string] $LambdaArtifactPath = '')
