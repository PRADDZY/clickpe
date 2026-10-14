function Invoke-ClickPeServerless {
    param(
        [Parameter(Mandatory)] [string] $CliPath,
        [Parameter(Mandatory)] [string] $AwsProfile,
        [Parameter(Mandatory)] [string[]] $Arguments
    )

    $names = @('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_REGION')
    $previous = @{}
    foreach ($name in $names) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }

    try {
        $env:AWS_PROFILE = $AwsProfile
        $env:AWS_REGION = 'ap-south-1'
        $rawCredentials = & aws configure export-credentials --profile $AwsProfile --format process
        if ($LASTEXITCODE -ne 0) { throw 'Could not read the active AWS CLI session.' }
        $credentials = ($rawCredentials -join "`n") | ConvertFrom-Json
        $env:AWS_ACCESS_KEY_ID = $credentials.AccessKeyId
        $env:AWS_SECRET_ACCESS_KEY = $credentials.SecretAccessKey
        $env:AWS_SESSION_TOKEN = $credentials.SessionToken
        Remove-Item Env:\AWS_PROFILE -ErrorAction SilentlyContinue

        & $CliPath @Arguments
        if ($LASTEXITCODE -ne 0) { throw 'Serverless Framework command failed.' }
    }
    finally {
        foreach ($name in $names) {
            if ($null -eq $previous[$name]) {
                Remove-Item "Env:\$name" -ErrorAction SilentlyContinue
            } else {
                Set-Item "Env:\$name" $previous[$name]
            }
        }
    }
}
