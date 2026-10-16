# Demo recording: 7-8 minute walkthrough

Use the synthetic assignment CSV. Hide tokens, keys, passwords, account secrets, and applicant contact details. Record the browser and n8n editor. Rehearse with a completed run available, then upload a fresh file during the recording.

## 0:00-1:00 - Architecture and event flow

Show the README diagram. Explain S3 - SQS - Python Lambda - RDS for bulk import, followed by the transactional outbox - relay - n8n. Explain bounded pages, pinned policy versions, and the meaning of eligible, ineligible, and review. The lender makes the final decision.

## 1:00-2:15 - n8n discovery workflow

Open Policies, then show the daily India-time schedule, two official product sources, source excerpts, changed-source check, structured extraction and provider fallback, and the pending-review API. Show source-backed rates after a successful extraction. Explain untrusted page content and operator approval. Provider credentials remain a prerequisite; do not imply curated baseline data came from a live model execution.

## 2:15-4:00 - Upload and matching

On Overview upload `users.csv` in preview mode. Show byte upload progress, import activity and saved matching decisions. Navigate to Applicants while processing continues. Open Workflow B: authenticated webhook, bounded Postgres hard-rule screen, candidate JavaScript evaluation, and persistence callback. Explain the 400-decision page bound. Show a completed run with 10,000 profiles and measured SQL rejection/candidate counts.

## 4:00-5:15 - Explanations and policy versions

Filter matched, no-match and needs-review applicants. Show one row per profile and open its decision drawer: every lender, observed values, thresholds, pinned evidence and official sources. Use numbered pagination and page size. Explain preferred versus required criteria and missing data. On Policies show a pending proposal and explain why approval affects future runs.

## 5:15-6:30 - SES test delivery

Use a completed demo run sent to the two owned Gmail plus aliases required by the assignment. Alias verification and delivery are still pending. The base-address run `b29cae53-27cd-442f-bceb-6f42e48e6c02` already proves three personalized deliveries, confirmed in Spam by the user on 16 October, but does not demonstrate the aliases. Show Workflow C's per-applicant bundles, leased claims, pacing, send gate, personalized message, SES node, receipt callback and minute schedule. Show received messages with matched products and masked addresses without claiming Inbox placement. Explain that destinations come only from the verified allowlist and bulk analysis uses preview mode.

## 6:30-7:45 - Reliability and optimization

Show one malformed CSV rejection and the passing CI checks. Explain retryable import errors, idempotent page callbacks, failure visibility, the retry button, and retained policy versions. Give the measured elapsed time, total applicant-product decisions, maximum batch size, and zero LLM calls per applicant-product pair. Finish with retention and the remaining documented limitations.
