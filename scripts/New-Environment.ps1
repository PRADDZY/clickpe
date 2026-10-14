$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env'

if (Test-Path -LiteralPath $envPath) {
    throw 'A .env file already exists. Keep it as-is and edit it directly if needed.'
}

function New-SecretHex([int] $byteCount) {
    $buffer = New-Object byte[] $byteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
    return [System.BitConverter]::ToString($buffer).Replace('-', '').ToLowerInvariant()
}

$databasePassword = New-SecretHex 32
$escapedPassword = [System.Uri]::EscapeDataString($databasePassword)
$values = @(
    '# Generated locally. Keep this file private and out of source control.'
    'APP_ENV=development'
    "DATABASE_URL=postgresql://loan_engine:$escapedPassword@db:5432/loan_engine"
    "POSTGRES_PASSWORD=$databasePassword"
    'LOCAL_UPLOAD_DIR=/data/uploads'
    'MAX_UPLOAD_BYTES=26214400'
    'RETENTION_DAYS=7'
    "OPERATOR_TOKEN=$(New-SecretHex 32)"
    "INTERNAL_API_TOKEN=$(New-SecretHex 32)"
    'N8N_WEBHOOK_URL=http://n8n:5678/webhook/match-run'
    "N8N_ENCRYPTION_KEY=$(New-SecretHex 32)"
    'N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true'
    "N8N_RUNNERS_AUTH_TOKEN=$(New-SecretHex 32)"
    'AWS_REGION=ap-south-1'
    'S3_UPLOAD_BUCKET='
    'TEST_RECIPIENTS='
    'NOTIFICATION_MODE=preview'
)
Set-Content -LiteralPath $envPath -Value $values -Encoding ascii
Write-Output 'Created .env with random local secrets. It is excluded from Git.'
