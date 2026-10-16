# Release verification

Verified on 16 October 2026. Submission deadline: **17 October 2026, 15:44 IST**, as corrected by the user.

## Initial workspace release

- [Hosted workspace](https://vqm5co28ei.execute-api.ap-south-1.amazonaws.com)
- Initial Lambda and EC2 API health checks both reported `41f0ff2331f67602c689b567c09a1dd405a647f4`.
- The deployment preserved the current EC2 instance and AMI, waited for cloud-init, and completed its Systems Manager rollout successfully.
- At that check, matching and notification workflows were published; discovery was inactive pending private provider credentials.
- Temporary SES role assumption succeeded. That release used preview mode with zero configured delivery recipients.
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

## Credentials and received-email demonstration

Completed later on 16 October 2026 at runtime revision `f20a6a0`:

- `keys.txt` was added to `.gitignore` before staging and was never tracked. Both provider keys authenticated successfully and were transferred privately to the n8n host. No key values are stored in this report or repository.
- All three workflows were published with the provider credentials bound.
- AWS confirmed the controlled email identity as verified in `ap-south-1`.
- Test delivery was restricted to that verified address, with a three-message run cap.
- Headed Chrome uploaded three invented eligible applicants for run `b29cae53-27cd-442f-bceb-6f42e48e6c02`.
- All three applicants matched; the notification ledger recorded **3 sent, 0 pending, 0 needing attention**.
- The user confirmed **all three personalized emails arrived in Spam**. Received delivery is demonstrated; Inbox placement is not.
- Preview mode was restored and verified on Lambda and EC2 at `f20a6a0`; one controlled recipient remains configured and all three workflows remain published.

The DOCX explicitly requests test-inbox aliases. The completed base-address run proves delivery, but permission to verify and demonstrate two Gmail plus aliases remains pending. Do not represent the alias-specific criterion as complete.

Local evidence: ignored `.runtime/ses-demo-report.json` and `output/playwright/ses-three-sent.png`. Preserve the received messages for the recording; mask the inbox address when sharing it.

## Submission work still pending

1. Run discovery and retain source-supported extraction/review evidence. A live check fetched both official pages and reached both providers, but OpenRouter returned 402 (no purchased credits) and Gemini returned 503 (temporary high demand), including a retry. No proposals were accepted and the catalogue was unchanged. The check used an unpublished workflow copy with a temporary CLI start trigger; the original daily workflow was unchanged. A free-model versus paid-credit choice is pending.
2. Verify and demonstrate the two owned plus aliases requested by the assignment, subject to the user's pending authorization.
3. Complete the n8n owner/editor setup for recording access; deployment and server CLI checks do not create the user's editor password.
4. Record the 5–10 minute walkthrough using [the demo script](demo-script.md).
5. Invite the assignment's four GitHub reviewers when the user is ready; invitations are explicitly deferred.
6. Complete the submission form manually with repository and recording links.

The repository and hosted workspace do not establish completion of the remaining live discovery, alias-specific demonstration or recording requirements.
