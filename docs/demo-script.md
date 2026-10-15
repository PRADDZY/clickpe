# Demo recording: 7-8 minute walkthrough

Use the synthetic assignment CSV. Hide tokens, keys, passwords, account secrets, and applicant contact details. Record the browser and n8n editor. Rehearse with a completed run available, then upload a fresh file during the recording.

## 0:00-1:00 - Architecture and event flow

Show the README diagram. Explain S3 - SQS - Python Lambda - RDS for bulk import, followed by the transactional outbox - relay - n8n. Explain bounded pages, pinned policy versions, and the meaning of eligible, ineligible, and review. The lender makes the final decision.

## 1:00-2:15 - n8n discovery workflow

Show the schedule, the two official product sources, source-excerpt extraction, changed-source check, structured extraction and provider fallback, and the pending-review API. Show source-backed rate metadata when available. Explain how untrusted page content is treated and why operator approval is required. Demonstrate this only after provider credentials are configured and an execution succeeds; identify any remaining limitation honestly.

## 2:15-4:00 - Upload and matching

Upload `users.csv`. Show visible import/matching progress. Open Workflow B and walk through the authenticated webhook, Postgres page query, JavaScript rule evaluation, and persistence callback. Explain that the page size adapts to product count and never exceeds 400 decisions. Show a completed run with 10,000 profiles and its total decisions.

## 4:00-5:15 - Explanations and policy versions

Filter eligible, ineligible, and review decisions. Open the evidence dialog: observed value, required threshold, rule version, pinned snapshot, and official source. Browse the next page. Explain preferred versus required criteria and missing eligibility data. Show a pending proposal and explain why approval changes future runs.

## 5:15-6:30 - SES test delivery

Show Workflow C's preview preparation, controlled-recipient gate, SES node, and receipt callback. Show the personalized email received in your controlled inbox and its matched product list, masking the address. Explain that all CSV addresses are replaced by the allowlisted test destination and that only one sample email is sent per run. Do not claim this section is complete while delivery is disabled.

## 6:30-7:45 - Reliability and optimization

Show one malformed CSV rejection and the passing CI checks. Explain retryable import errors, idempotent page callbacks, failure visibility, the retry button, and retained policy versions. Give the measured elapsed time, total applicant-product decisions, maximum batch size, and zero LLM calls per applicant-product pair. Finish with retention and the remaining documented limitations.
