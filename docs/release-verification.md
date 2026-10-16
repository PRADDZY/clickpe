# Release verification

Verified on 16 October 2026. Submission deadline: **17 October 2026, 15:44 IST**, as corrected by the user.

## Deployed release

- [Hosted workspace](https://vqm5co28ei.execute-api.ap-south-1.amazonaws.com)
- Lambda and EC2 API health both report `41f0ff2331f67602c689b567c09a1dd405a647f4`.
- The deployment preserved the current EC2 instance and AMI, waited for cloud-init, and completed its Systems Manager rollout successfully.
- Matching and notification workflows are published. Discovery is inactive pending private provider credentials.
- Temporary SES role assumption succeeded. Notification mode is preview, with zero configured delivery recipients.
- [Merged implementation](https://github.com/PRADDZY/clickpe/pull/1), [merged host rollout fix](https://github.com/PRADDZY/clickpe/pull/2).

## Automated checks

[Merged-release CI](https://github.com/PRADDZY/clickpe/actions/runs/38918821169): **39 passed, 1 skipped**; Ruff and frontend build passed. The skipped backend check requires built frontend assets, which are built in the separate frontend job. Deployed page and asset serving were checked directly below.

[Isolated matching benchmark](https://github.com/PRADDZY/clickpe/actions/runs/38914198384): all 500,000 decisions and ordered explanations matched the frozen previous evaluator. See [benchmark measurements and limits](benchmark.md).

## Visible Chrome verification

Used headed Playwright against the hosted release, with private operator-token retrieval and no credential logging.

- Signed in and loaded Overview, Applicants and Policies directly by URL.
- Confirmed an unknown API path returns 404.
- Uploaded the supplied 10,000-row CSV and observed visible Upload, Import, Match and Ready phases.
- Navigated to Policies and back, then refreshed during matching; processing resumed.
- Saved all 20,000 product decisions for run `dbc3c908-6ef6-4e2d-ae02-b755321de963`.
- Checked next-page navigation, 25/50 page sizes, status filtering, empty prefix search and page reset.
- Opened the decision drawer, closed it with Escape and confirmed focus returned to its trigger.
- Checked a 390-pixel mobile viewport: no document-level horizontal overflow.
- Aborted a signing request locally in the browser and confirmed visible upload failure with file selection available again. This did not send a file or alter the completed run.
- Confirmed 2,281 notification previews, zero sent, zero pending and zero needing attention.

Local screenshots and the numeric browser report are under ignored `output/playwright/` and `.runtime/live-report.json`. They contain no operator token or signed upload fields. The visible browser was left open for inspection.

## Submission work still pending

1. Configure OpenRouter and Gemini credentials privately; run discovery and retain source-supported extraction/review evidence. Instructions are in the README.
2. Complete SES sender/recipient verification and demonstrate received emails. The user deferred inbox configuration and live delivery.
3. Record the 5–10 minute walkthrough using [the demo script](demo-script.md).
4. Invite the assignment's four GitHub reviewers when the user is ready; invitations are explicitly deferred.
5. Complete the submission form manually with repository and recording links.

The repository and hosted workspace do not establish completion of the deferred live discovery, received-email or recording requirements.
