# Workspace completion

Approved implementation plan, 15 October 2026. Submission deadline corrected by the user on 16 October: **17 October 2026, 15:44 IST**, 72 hours after 14 October at 15:44 IST.

- [x] Three routes: Overview, Applicants, Policies; polished operator UI.
- [x] Real upload byte progress, import indicator, matching progress, route/reload tracking.
- [x] Grouped applicant API, accessible decision drawer, numbered pagination and filters.
- [x] SQL hard-rule pre-filter in n8n, complete explanations, candidate evaluation and parity tests.
- [x] Daily discovery timezone, source-supported rates and approval workflow implementation.
- [ ] Private provider credentials and successful live discovery evidence.
- [x] Per-applicant notification ledger, controlled recipients, SES role credentials and recovery.
- [x] Unit/integration checks, headed browser verification and measured benchmark.
- [x] Deploy matching revisions to Lambda and host; verify published workflows.
- [x] README and demo runbook.
- [ ] Received-email demonstration, recorded video and submission handoff.

## Defaults

25 applicants per page; 25/50/100 choices. Fully evaluated applicants are matched if any product is eligible, otherwise review if any requires review, otherwise unmatched. Incomplete applicants remain processing. Policy versions are pinned per run.

Four upload stages: Upload / Import / Match / Ready. Byte percentage applies only to transfer; import is indeterminate; matching uses persisted decision counts. Refresh resumes acknowledged jobs, not unfinished file transfers.

Notification mode is captured per run. Preview is the default. Test delivery uses verified, explicit inbox aliases and a default three-message run cap; excess work remains visibly deferred. A complete three-applicant email demo is separate from the 10,000-applicant preview benchmark. Missing send receipts never trigger automatic resending.

## External prerequisites

The user has deferred the owned inbox and SES verification. Provider keys must be configured privately. Reviewer invitations remain deferred. Do not submit the application form automatically.

## Verification

Compare staged decisions and ordered findings with the reference evaluator, allowing the engine version change. Test callback idempotence, pinned policies, pagination/filter boundaries, upload recovery, notification recipient enforcement, claims, pacing and uncertain sends. Use headed Playwright for deployed routes and full upload flow. Record actual discovery and received-email evidence only after credentials are configured.

Release verification on 16 October 2026 is recorded in [release-verification.md](release-verification.md). Both runtime services run revision `41f0ff2`; matching and notification workflows are published. Discovery remains inactive until private provider credentials are configured.
