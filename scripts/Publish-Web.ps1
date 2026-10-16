param([string] $AwsProfile = 'dpratik', [string] $Stage = 'demo')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$previousApiUrl = [Environment]::GetEnvironmentVariable('VITE_API_BASE_URL', 'Process')

Push-Location $projectRoot
try {
    $env:VITE_API_BASE_URL = ''
    & (Join-Path $PSScriptRoot 'Deploy-Aws.ps1') -AwsProfile $AwsProfile -Stage $Stage
    if ($LASTEXITCODE -ne 0) { throw 'Could not deploy the console and API.' }

    $stackName = "clickpe-loan-engine-$Stage"
    $stackText = & aws cloudformation describe-stacks --stack-name $stackName --profile $AwsProfile --region ap-south-1 --output json
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the deployed API URL.' }
    $stack = ($stackText -join "`n") | ConvertFrom-Json
    $outputs = @{}
    foreach ($item in $stack.Stacks[0].Outputs) { $outputs[$item.OutputKey] = $item.OutputValue }
    if (-not $outputs.ApiBaseUrl -or -not $outputs.OperatorTokenSecretArn) {
        throw 'The deployed stack is missing the console URL or operator-token secret ARN.'
    }

    $consoleUrl = $outputs.ApiBaseUrl.TrimEnd('/')
    $page = Invoke-WebRequest -UseBasicParsing -Uri $consoleUrl -TimeoutSec 45
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch '<title>ClickPe \| Eligibility workspace</title>') {
        throw 'The public console page did not return the expected HTML.'
    }
    if (-not $page.Headers['Content-Security-Policy']) { throw 'The public console is missing its Content-Security-Policy header.' }

    $scriptMatch = [regex]::Match($page.Content, '<script[^>]+src="([^"]+\.js)"')
    if (-not $scriptMatch.Success) { throw 'Could not find the built console script in the public page.' }
    $scriptPath = $scriptMatch.Groups[1].Value
    $script = Invoke-WebRequest -UseBasicParsing -Uri ($consoleUrl + $scriptPath) -TimeoutSec 45
    if ($script.StatusCode -ne 200) { throw 'The public console JavaScript bundle could not be loaded.' }

    $health = Invoke-RestMethod -Uri ($consoleUrl + '/health') -TimeoutSec 45
    if ($health.status -ne 'ok') { throw 'The public API health route did not pass.' }

    Write-Output ''
    Write-Output ("Public console: {0}" -f $consoleUrl)
    Write-Output ("API health: {0}/health returned {1}" -f $consoleUrl, $health.status)
    Write-Output ("Operator token secret: {0}" -f $outputs.OperatorTokenSecretArn)
    Write-Output 'The console and API share HTTPS on the API Gateway origin. Sign-in requires the operator token.'
    Write-Output 'Notification mode follows the deployed configuration; delivery requires verified controlled recipients.'
}
finally {
    if ($null -eq $previousApiUrl) {
        Remove-Item Env:\VITE_API_BASE_URL -ErrorAction SilentlyContinue
    } else {
        Set-Item Env:\VITE_API_BASE_URL $previousApiUrl
    }
    Pop-Location
}
