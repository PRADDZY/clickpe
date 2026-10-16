param([string] $AwsProfile = 'dpratik', [string] $Stage = 'demo', [string] $LambdaArtifactPath = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverlessCli = Join-Path $projectRoot 'node_modules\.bin\serverless.cmd'
$sourceStage = Join-Path $env:TEMP ("clickpe-source-" + [guid]::NewGuid().ToString('N'))
$previousWebOrigin = [Environment]::GetEnvironmentVariable('WEB_ORIGIN', 'Process')
$previousFrontendApiUrl = [Environment]::GetEnvironmentVariable('VITE_API_BASE_URL', 'Process')
$previousHostImage = [Environment]::GetEnvironmentVariable('N8N_AMI_ID', 'Process')
$previousNotificationEnv = @{}
foreach ($key in @('NOTIFICATION_MODE','SES_SENDER','TEST_RECIPIENTS')) {
    $previousNotificationEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
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
    Write-Output ("Deploying the demo stack to AWS account {0} in ap-south-1." -f $identity.Account)
    $notificationJson = & uv run python -c "import json; from app.config import get_settings; s=get_settings(); print(json.dumps({'mode':s.notification_mode,'sender':s.ses_sender.strip().lower(),'recipients':','.join(sorted(s.test_recipient_list))}))"
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve notification settings from the private environment.' }
    $notificationSettings = ($notificationJson -join "`n") | ConvertFrom-Json
    $env:NOTIFICATION_MODE = $notificationSettings.mode
    # The same normalized settings configure IAM, Lambda and the host. Defaults
    # reference a non-existent identity and recipient, granting no usable send.
    $env:SES_SENDER = if ($notificationSettings.sender) { $notificationSettings.sender } else { 'unconfigured@example.invalid' }
    $env:TEST_RECIPIENTS = if ($notificationSettings.recipients) { $notificationSettings.recipients } else { 'unconfigured@example.invalid' }
    $revision = & git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the deployment revision.' }
    $release = @{commit=$revision;built_at=[DateTimeOffset]::UtcNow.ToString('o')} | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $projectRoot 'app/release.json'), $release, [Text.UTF8Encoding]::new($false))

    if (-not $LambdaArtifactPath) {
        if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or newer before building the console.' }
        $env:VITE_API_BASE_URL = ''
        Push-Location (Join-Path $projectRoot 'web')
        try {
            & npm.cmd ci
            if ($LASTEXITCODE -ne 0) { throw 'Could not install the locked console dependencies.' }
            & npm.cmd run build
            if ($LASTEXITCODE -ne 0) { throw 'Could not build the console.' }
        }
        finally { Pop-Location }
    }

    $stackName = "clickpe-loan-engine-$Stage"
    $existingStackText = & aws cloudformation describe-stacks --stack-name $stackName --profile $AwsProfile --region ap-south-1 --output json 2>$null
    if ($LASTEXITCODE -eq 0) {
        $existingStack = ($existingStackText -join "`n") | ConvertFrom-Json
        $existingApiOutput = $existingStack.Stacks[0].Outputs | Where-Object { $_.OutputKey -eq 'ApiBaseUrl' } | Select-Object -First 1
        if ($existingApiOutput) { $env:WEB_ORIGIN = $existingApiOutput.OutputValue }
        $existingHostOutput = $existingStack.Stacks[0].Outputs | Where-Object { $_.OutputKey -eq 'N8nInstanceId' } | Select-Object -First 1
        if ($existingHostOutput -and -not $env:N8N_AMI_ID) {
            $hostImage = & aws ec2 describe-instances --profile $AwsProfile --region ap-south-1 --instance-ids $existingHostOutput.OutputValue --query 'Reservations[0].Instances[0].ImageId' --output text
            if ($LASTEXITCODE -ne 0 -or $hostImage -notmatch '^ami-[a-f0-9]+$') { throw 'Could not preserve the existing n8n host image.' }
            $env:N8N_AMI_ID = $hostImage
            Write-Output 'Preserving the existing n8n host image. Set N8N_AMI_ID explicitly for a planned image upgrade.'
        }
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

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $lambdaZip = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $projectRoot '.aws-build\loan-engine.zip'))
    try {
        if (-not ($lambdaZip.Entries | Where-Object { ($_.FullName -replace '\\', '/') -ceq 'web/dist/index.html' })) {
            throw 'The Linux Lambda package is missing the built console. Run the updated Lambda package workflow.'
        }
        if ($lambdaZip.Entries | Where-Object { $_.FullName.Contains('\') }) {
            throw 'The Lambda package contains non-portable ZIP paths. Rebuild it with the updated package workflow.'
        }
    }
    finally { $lambdaZip.Dispose() }

    Invoke-ClickPeServerless -CliPath $serverlessCli -AwsProfile $AwsProfile -Arguments @('deploy', '--stage', $Stage)
    $stackJson = & aws cloudformation describe-stacks --stack-name $stackName --profile $AwsProfile --region ap-south-1 --output json
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the completed stack outputs.' }
    $stack = $stackJson | ConvertFrom-Json
    $outputs = @{}
    foreach ($item in $stack.Stacks[0].Outputs) { $outputs[$item.OutputKey] = $item.OutputValue }
    if ($env:WEB_ORIGIN -ne $outputs.ApiBaseUrl) {
        $env:WEB_ORIGIN = $outputs.ApiBaseUrl
        Write-Output ("Restricting web and upload access to the API origin {0}." -f $outputs.ApiBaseUrl)
        Invoke-ClickPeServerless -CliPath $serverlessCli -AwsProfile $AwsProfile -Arguments @('deploy', '--stage', $Stage)
        $stackJson = & aws cloudformation describe-stacks --stack-name $stackName --profile $AwsProfile --region ap-south-1 --output json
        if ($LASTEXITCODE -ne 0) { throw 'Could not read the updated stack outputs.' }
        $stack = $stackJson | ConvertFrom-Json
        $outputs = @{}
        foreach ($item in $stack.Stacks[0].Outputs) { $outputs[$item.OutputKey] = $item.OutputValue }
    }

    Invoke-ClickPeServerless -CliPath $serverlessCli -AwsProfile $AwsProfile -Arguments @('invoke', '--stage', $Stage, '--function', 'migrate')

    $included = @(
        'app', 'migrations', 'n8n/workflows', 'web/src', 'scripts',
        'web/package.json', 'web/package-lock.json', 'web/index.html', 'web/vite.config.ts',
        'web/tsconfig.json', 'web/nginx.conf', 'web/Dockerfile',
        'docker-compose.yml', 'Dockerfile', '.dockerignore', 'pyproject.toml',
        'web/.dockerignore', 'uv.lock'
    )
    New-Item -ItemType Directory -Force -Path $sourceStage | Out-Null
    foreach ($path in $included) { Copy-ProjectPath $path }
    Get-ChildItem -LiteralPath $sourceStage -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath $sourceStage -Recurse -File -Filter '*.pyc' | Remove-Item -Force
    $sourceZip = Join-Path $env:TEMP ("clickpe-bundle-" + [guid]::NewGuid().ToString('N') + '.zip')
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archiveStream = [System.IO.File]::Open(
        $sourceZip,
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
        $stageLeaf = Split-Path -Leaf $sourceStage
        foreach ($file in Get-ChildItem -LiteralPath $sourceStage -Recurse -File) {
            $fileParts = @($file.FullName -split '[\\/]')
            $stageIndex = [Array]::IndexOf($fileParts, $stageLeaf)
            if ($stageIndex -lt 0 -or [Array]::IndexOf($fileParts, $stageLeaf, [int]($stageIndex + 1)) -ge 0) {
                throw 'Could not resolve a file path relative to the application bundle root.'
            }
            $relativeParts = @($fileParts[($stageIndex + 1)..($fileParts.Length - 1)])
            $entryName = [string]::Join('/', $relativeParts)
            if (-not $entryName -or $entryName.StartsWith('/') -or $entryName -match '(^|/)\.\.(/|$)') {
                throw 'The application bundle contains an unsafe ZIP path.'
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
    $bundle = [System.IO.Compression.ZipFile]::OpenRead($sourceZip)
    try {
        if ($bundle.Entries | Where-Object { $_.FullName.Contains('\') }) {
            throw 'The application bundle contains non-portable ZIP paths.'
        }
        if (-not ($bundle.Entries | Where-Object { $_.FullName -ceq 'docker-compose.yml' })) {
            throw 'The application bundle is missing docker-compose.yml at its root.'
        }
    }
    finally { $bundle.Dispose() }
    try {
        & aws s3 cp $sourceZip ("s3://{0}/deployment/source.zip" -f $outputs.UploadBucketName) --profile $AwsProfile --region ap-south-1 --sse AES256
        if ($LASTEXITCODE -ne 0) { throw 'Could not upload the private EC2 application bundle.' }
        $bundleDigest = (Get-FileHash -LiteralPath $sourceZip -Algorithm SHA256).Hash.ToLowerInvariant()
        $notificationMode = $notificationSettings.mode
        & (Join-Path $PSScriptRoot 'Update-AwsHost.ps1') -AwsProfile $AwsProfile -InstanceId $outputs.N8nInstanceId -BucketName $outputs.UploadBucketName -BundleSha256 $bundleDigest -SesRoleArn $outputs.SesRoleArn -SesExternalIdSecretArn $outputs.SesExternalIdSecretArn -NotificationMode $notificationMode -SesSender $notificationSettings.sender -TestRecipients $notificationSettings.recipients
    }
    finally { Remove-Item -LiteralPath $sourceZip -Force -ErrorAction SilentlyContinue }

    Write-Output ''
    Write-Output 'The AWS demo stack is ready.'
    Write-Output ("Public console and API: {0}" -f $outputs.ApiBaseUrl)
    Write-Output ("EC2 instance: {0}" -f $outputs.N8nInstanceId)
    Write-Output ("Database host: {0}" -f $outputs.DatabaseHost)
    Write-Output ("Operator token secret ARN: {0}" -f $outputs.OperatorTokenSecretArn)
    Write-Output 'The n8n host accepts no inbound connections; use an AWS Systems Manager port-forwarding session as described in README.md.'
    Write-Output 'Matching and notification workflows are published. Discovery is published when both model credentials are configured.'
    Write-Output ("Notification mode: {0}. Delivery requires verified, configured controlled recipients." -f $notificationMode)
}
finally {
    if ($null -eq $previousHostImage) { Remove-Item Env:\N8N_AMI_ID -ErrorAction SilentlyContinue }
    else { Set-Item Env:\N8N_AMI_ID $previousHostImage }
    foreach ($key in $previousNotificationEnv.Keys) {
        if ($null -eq $previousNotificationEnv[$key]) { Remove-Item "Env:\$key" -ErrorAction SilentlyContinue }
        else { Set-Item "Env:\$key" $previousNotificationEnv[$key] }
    }
    if (Test-Path -LiteralPath $sourceStage) { Remove-Item -LiteralPath $sourceStage -Recurse -Force }
    if ($null -eq $previousWebOrigin) {
        Remove-Item Env:\WEB_ORIGIN -ErrorAction SilentlyContinue
    } else {
        Set-Item Env:\WEB_ORIGIN $previousWebOrigin
    }
    if ($null -eq $previousFrontendApiUrl) {
        Remove-Item Env:\VITE_API_BASE_URL -ErrorAction SilentlyContinue
    } else {
        Set-Item Env:\VITE_API_BASE_URL $previousFrontendApiUrl
    }
    Pop-Location
}
