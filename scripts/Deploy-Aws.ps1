param([string] $AwsProfile = 'dpratik', [string] $Stage = 'demo', [string] $LambdaArtifactPath = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverlessCli = Join-Path $projectRoot 'node_modules\.bin\serverless.cmd'
$sourceStage = Join-Path $env:TEMP ("clickpe-source-" + [guid]::NewGuid().ToString('N'))
. (Join-Path $PSScriptRoot 'Invoke-ClickPeServerless.ps1')

function Copy-ProjectPath([string] $RelativePath) {
    $source = Join-Path $projectRoot $RelativePath
    $target = Join-Path $sourceStage $RelativePath
    $parent = Split-Path -Parent $target
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    if (Test-Path -LiteralPath $source -PathType Container) {
        Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
    } else {
        Copy-Item -LiteralPath $source -Destination $target -Force
    }
}

Push-Location $projectRoot
try {
    if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw 'Install the AWS CLI before deploying.' }
    if (-not (Test-Path -LiteralPath $serverlessCli)) {
        throw 'Run npm ci at the project root before deploying.'
    }
    $env:AWS_PROFILE = $AwsProfile
    $env:AWS_REGION = 'ap-south-1'
    $identityText = & aws sts get-caller-identity --profile $AwsProfile --output json
    if ($LASTEXITCODE -ne 0) { throw 'The selected AWS profile is not authenticated.' }
    $identity = $identityText | ConvertFrom-Json
    Write-Output ("Deploying the private demo stack to AWS account {0} in ap-south-1." -f $identity.Account)

    & uv export --locked --no-dev --no-hashes --no-emit-project --format requirements.txt --output-file requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Could not export the locked Python runtime dependencies.' }
    if ($LambdaArtifactPath) {
        & (Join-Path $PSScriptRoot 'Copy-LambdaArtifact.ps1') -SourcePath $LambdaArtifactPath
        if ($LASTEXITCODE -ne 0) { throw 'Could not stage the Linux Lambda package.' }
    } else {
        & (Join-Path $PSScriptRoot 'New-LambdaPackage.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Could not build the Linux Lambda package.' }
    }
    Invoke-ClickPeServerless -CliPath $serverlessCli -AwsProfile $AwsProfile -Arguments @('deploy', '--stage', $Stage)

    Invoke-ClickPeServerless -CliPath $serverlessCli -AwsProfile $AwsProfile -Arguments @('invoke', '--stage', $Stage, '--function', 'migrate')

    $stackName = "clickpe-loan-engine-$Stage"
    $stackJson = & aws cloudformation describe-stacks --stack-name $stackName --profile $AwsProfile --region ap-south-1 --output json
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the completed stack outputs.' }
    $stack = $stackJson | ConvertFrom-Json
    $outputs = @{}
    foreach ($item in $stack.Stacks[0].Outputs) { $outputs[$item.OutputKey] = $item.OutputValue }

    $included = @(
        'app', 'migrations', 'n8n/workflows', 'web/src', 'scripts/New-Environment.ps1',
        'web/package.json', 'web/package-lock.json', 'web/index.html', 'web/vite.config.ts',
        'web/tsconfig.json', 'web/nginx.conf', 'web/Dockerfile',
        'docker-compose.yml', 'Dockerfile', 'pyproject.toml'
    )
    New-Item -ItemType Directory -Force -Path $sourceStage | Out-Null
    foreach ($path in $included) { Copy-ProjectPath $path }
    Get-ChildItem -LiteralPath $sourceStage -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath $sourceStage -Recurse -File -Filter '*.pyc' | Remove-Item -Force
    $sourceZip = Join-Path $env:TEMP ("clickpe-bundle-" + [guid]::NewGuid().ToString('N') + '.zip')
    Compress-Archive -Path (Join-Path $sourceStage '*') -DestinationPath $sourceZip -CompressionLevel Optimal
    try {
        & aws s3 cp $sourceZip ("s3://{0}/deployment/source.zip" -f $outputs.UploadBucketName) --profile $AwsProfile --region ap-south-1 --sse AES256
        if ($LASTEXITCODE -ne 0) { throw 'Could not upload the private EC2 application bundle.' }
    }
    finally { Remove-Item -LiteralPath $sourceZip -Force -ErrorAction SilentlyContinue }

    Write-Output ''
    Write-Output 'The private demo stack is ready.'
    Write-Output ("Console: {0}" -f $outputs.ApiBaseUrl)
    Write-Output ("EC2 instance: {0}" -f $outputs.N8nInstanceId)
    Write-Output ("Database host: {0}" -f $outputs.DatabaseHost)
    Write-Output ("Operator token secret ARN: {0}" -f $outputs.OperatorTokenSecretArn)
    Write-Output 'The console and n8n are private on the instance. Use an AWS Systems Manager port-forwarding session as described in README.md.'
    Write-Output 'In n8n, add the Postgres and authenticated HTTP credentials, then activate the three imported workflows.'
    Write-Output 'Notifications are in preview mode; no applicant emails are sent.'
}
finally {
    if (Test-Path -LiteralPath $sourceStage) { Remove-Item -LiteralPath $sourceStage -Recurse -Force }
    Pop-Location
}
