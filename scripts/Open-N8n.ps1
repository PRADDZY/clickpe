param([string] $AwsProfile = 'dpratik', [string] $Stage = 'demo')
$ErrorActionPreference = 'Stop'
$instanceId = & aws cloudformation describe-stacks --profile $AwsProfile --region ap-south-1 --stack-name "clickpe-loan-engine-$Stage" --query "Stacks[0].Outputs[?OutputKey=='N8nInstanceId'].OutputValue | [0]" --output text
if ($LASTEXITCODE -ne 0 -or $instanceId -notmatch '^i-[a-f0-9]+$') {
    throw 'Could not resolve the n8n instance. Check the AWS session and stack.'
}
$parameterFile = Join-Path $env:TEMP ('clickpe-tunnel-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    $parameters = @{portNumber=@('5678');localPortNumber=@('5678')} | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($parameterFile,$parameters,[Text.UTF8Encoding]::new($false))
    Write-Output 'Open http://localhost:5678 in your browser. Keep this terminal open while using n8n.'
    & aws ssm start-session --profile $AwsProfile --region ap-south-1 --target $instanceId --document-name AWS-StartPortForwardingSession --parameters "file://$parameterFile"
    if ($LASTEXITCODE -ne 0) { throw 'The n8n port-forwarding session failed.' }
}
finally { Remove-Item -LiteralPath $parameterFile -Force -ErrorAction SilentlyContinue }
