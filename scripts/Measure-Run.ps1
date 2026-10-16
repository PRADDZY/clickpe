param([Parameter(Mandatory=$true)][string] $RunId, [string] $AwsProfile = 'dpratik')
$ErrorActionPreference = 'Stop'
$operatorSecret = & aws secretsmanager get-secret-value --profile $AwsProfile --region ap-south-1 --secret-id /clickpe/demo/operator-token --query SecretString --output text
if ($LASTEXITCODE -ne 0) { throw 'Could not read the operator secret.' }
try {
    $headers = @{'X-Operator-Token'=$operatorSecret}
    $baseUrl = 'https://vqm5co28ei.execute-api.ap-south-1.amazonaws.com'
    $run = Invoke-RestMethod -Uri "$baseUrl/api/runs/$RunId" -Headers $headers
    $results = Invoke-RestMethod -Uri "$baseUrl/api/runs/$RunId/results?limit=1" -Headers $headers
    $elapsed = $null
    if ($run.started_at -and $run.completed_at) {
        $elapsed = [Math]::Round(([DateTimeOffset]::Parse($run.completed_at) - [DateTimeOffset]::Parse($run.started_at)).TotalSeconds, 2)
    }
    [ordered]@{
        run_id=$run.run_id; status=$run.status; applicants=$run.row_count
        decisions=$results.total; eligible=$run.matched_count
        ineligible=$run.unmatched_count; review=$run.review_count
        matching_elapsed_seconds=$elapsed; max_decisions_per_batch=400
        sql_prefiltered_pairs=$run.prefiltered_count; n8n_candidate_pairs=$run.candidate_count
        llm_calls_per_applicant_product_pair=0
    } | ConvertTo-Json
}
finally { $operatorSecret=$null; $headers=$null }
