param(
    [string] $AwsProfile = 'dpratik',
    [Parameter(Mandatory=$true)][string] $InstanceId,
    [Parameter(Mandatory=$true)][string] $BucketName,
    [Parameter(Mandatory=$true)][string] $BundleSha256,
    [string] $SesRoleArn = '',
    [string] $SesExternalIdSecretArn = '',
    [ValidateSet('preview', 'test')][string] $NotificationMode = 'preview',
    [string] $SesSender = '',
    [string] $TestRecipients = ''
)
$ErrorActionPreference = 'Stop'
if ($BucketName -notmatch '^[a-z0-9.-]+$' -or $BundleSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Invalid bundle location or digest.'
}
$notificationConfig = @{
    SES_ROLE_ARN=$SesRoleArn; SES_EXTERNAL_ID_SECRET_ARN=$SesExternalIdSecretArn
    NOTIFICATION_MODE=$NotificationMode; SES_SENDER=$SesSender; TEST_RECIPIENTS=$TestRecipients
}
foreach ($value in $notificationConfig.Values) {
    if ($value -match '[\r\n]') { throw 'Notification settings cannot contain newlines.' }
}
$encodedConfig = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($notificationConfig | ConvertTo-Json -Compress)))
$commands = @(
    'set -eu',
    'cd /opt/clickpe',
    "aws s3 cp 's3://$BucketName/deployment/source.zip' /tmp/clickpe-next.zip --region ap-south-1 --only-show-errors",
    "echo '$BundleSha256  /tmp/clickpe-next.zip' | sha256sum -c -",
    'tar -czf /opt/clickpe/previous-source.tar.gz app migrations n8n scripts docker-compose.yml Dockerfile pyproject.toml',
    'unzip -q -o /tmp/clickpe-next.zip -d /opt/clickpe',
    "printf '%s' '$encodedConfig' | base64 -d > /opt/clickpe/.notification-config.json",
    'chmod 600 /opt/clickpe/.notification-config.json',
    'python3 /opt/clickpe/scripts/update_notification_env.py',
    'sh /opt/clickpe/scripts/update-host.sh'
)
$parameterFile = Join-Path $env:TEMP ('clickpe-ssm-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    [IO.File]::WriteAllText($parameterFile, (@{commands=$commands;executionTimeout=@('1200')} | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    $commandId = & aws ssm send-command --profile $AwsProfile --region ap-south-1 --instance-ids $InstanceId --document-name AWS-RunShellScript --parameters "file://$parameterFile" --query Command.CommandId --output text
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the host rollout.' }
    Write-Output "Host rollout command: $commandId"
    for ($attempt=0; $attempt -lt 140; $attempt++) {
        Start-Sleep -Seconds 10
        $resultText = & aws ssm get-command-invocation --profile $AwsProfile --region ap-south-1 --command-id $commandId --instance-id $InstanceId --output json
        if ($LASTEXITCODE -ne 0) { throw 'Could not read host rollout status.' }
        $result = $resultText | ConvertFrom-Json
        if ($result.Status -in @('Pending','InProgress','Delayed')) {
            if ($attempt % 3 -eq 0) { Write-Output "Host rollout: $($result.Status)" }
            continue
        }
        Write-Output $result.StandardOutputContent
        if ($result.Status -ne 'Success') {
            Write-Output $result.StandardErrorContent
            throw "Host rollout failed: $($result.Status). Previous source and workflow exports are retained on the host."
        }
        return
    }
    throw 'Host rollout did not finish within the wait window; inspect the SSM command.'
}
finally { Remove-Item -LiteralPath $parameterFile -Force -ErrorAction SilentlyContinue }
