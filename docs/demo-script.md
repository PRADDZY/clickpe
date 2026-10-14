# Demo recording: explain the boundaries, then show one run

Target length: 3-4 minutes. Record the browser and editor side by side. Use the synthetic assignment CSV. Do not show credentials, email addresses, cloud account secrets, or any real applicant record.

## 1. Whiteboard first (45 seconds)

Draw four boxes: Upload/API, Postgres, n8n, lender sources. Show the AWS S3 -> SQS -> Lambda ingestion lane and the PostgreSQL transactional outbox -> relay -> n8n matching lane. Explain that n8n reads 200 profiles per page, the Code node applies fixed rules, and PostgreSQL stores explanations against a versioned policy snapshot. Explain how the outbox and unique cursors recover from retries.

## 2. Show one completed run (60 seconds)

Open the operations console, identify the active lender sources, upload `users.csv`, and point out that the names and email addresses stay masked. Show run status and counts. Open one eligible, one hard-rule failure and one review result. Explain that preferred criteria never become hard denials, unknown criteria produce review, and the lender makes the final decision.

## 3. Show the human review gate (45 seconds)

Open `Policy review`. Show the official source link, the extracted criterion summary, the version metadata and excerpt. Explain that daily source scraping plus structured extraction only proposes a snapshot; a human must approve it before future runs use it.

## 4. Show the notification boundary (30 seconds)

Open the notification preview. Show the unique-address count and the `delivery_enabled: false` result. Explain that the project has no verified test alias, so it records previews and never sends to applicant addresses.

## 5. Close with a failure case (45 seconds)

Explain one concrete failure path: a malformed CSV gets a safe error code; an SQS item retries and moves to a DLQ after repeated failure; n8n writes each page idempotently; applicant rows expire after seven days. Finish with how you would validate the source policy and test-delivery address before enabling any real lender notification workflow.
