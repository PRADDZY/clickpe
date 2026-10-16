# Matching benchmark

## Isolated synthetic catalogue

Measured on 16 October 2026 at revision `8857ced`, using GitHub Actions Ubuntu, PostgreSQL 16 and persistent Node workers. [Run and downloadable JSON](https://github.com/PRADDZY/clickpe/actions/runs/38914198384).

| Measure | Result |
|---|---:|
| Synthetic applicants | 10,000 |
| Synthetic products | 50 |
| Applicant-product decisions compared | 500,000 |
| SQL hard failures | 379,777 |
| Candidates sent to JavaScript | 120,223 |
| Candidate reduction | 75.96% |
| Bounded pages | 1,250 |
| Largest page | 400 decisions |
| SQL page-fetch time, cumulative | 39.32 seconds |
| Previous evaluator JavaScript time, cumulative | 93.91 milliseconds |
| Staged evaluator JavaScript time, cumulative | 17.57 milliseconds |
| Previous Node worker peak RSS | 108,773,376 bytes |
| Staged Node worker peak RSS | 106,328,064 bytes |
| Decision and ordered-explanation parity | Passed for every pair |
| Model calls per pair | 0 |

These are component measurements. The synthetic run excludes result persistence, n8n orchestration, network handoffs and hosted throughput. JavaScript timing excludes result canonicalization and hashing; Node RSS includes the worker and verification work. SQL still examines applicant-product pairs. The current rules are cheap, so reduced JavaScript work does not imply the same end-to-end speed improvement.

The benchmark creates and drops its own PostgreSQL schema, leaves the active catalogue intact, uses invented profiles and products, and sends no email. CI also runs a small isolation/parity case. To reproduce:

```powershell
# Point TEST_DATABASE_URL at disposable PostgreSQL, then:
uv sync --locked --extra dev
uv run python -m scripts.benchmark_matching --applicants 10000 --products 50 --output benchmark.json
```

Use the separate hosted 10,000-row CSV run for end-to-end evidence. Measure matching elapsed time from the saved run timestamps and retain its pinned product count, decision totals and pre-filter counters with `scripts/Measure-Run.ps1`.

## Hosted assignment CSV

Measured on 16 October 2026 against deployed revision `41f0ff2`. Run ID: `dbc3c908-6ef6-4e2d-ae02-b755321de963`. The file was uploaded through visible Chrome, imported through S3/SQS/Lambda and evaluated by the published n8n workflow with results persisted in RDS.

| Measure | Result |
|---|---:|
| Applicants | 10,000 |
| Pinned lender products | 2 |
| Saved product decisions | 20,000 |
| Eligible / ineligible / review decisions | 2,281 / 6,611 / 11,108 |
| SQL hard failures | 6,611 |
| Candidates sent to JavaScript | 13,389 |
| Candidate reduction | 33.06% |
| Matching elapsed time | 42.14 seconds |
| Matched / review / unmatched applicants | 2,281 / 7,719 / 0 |
| Notification previews / emails sent | 2,281 / 0 |
| Largest permitted page | 400 decisions |
| Model calls per applicant-product pair | 0 |

Matching elapsed time is `completed_at - started_at` from the saved run. It includes matching orchestration and persistence; it excludes browser transfer and CSV import. This is one hosted observation, not a controlled before/after speed comparison. The candidate reduction differs from the synthetic catalogue because the two catalogues contain different rules and products. Preview mode sends no email.
