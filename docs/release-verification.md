# Release verification

Updated **17 October 2026** (Asia/Kolkata). The user clarified the 72-hour deadline as 17 October 2026 at 15:44 IST.

## Current deployed release

- [Hosted workspace](https://vqm5co28ei.execute-api.ap-south-1.amazonaws.com)
- Main revision: `3d68ba0d937012817fb79dafc19f682e0a413a2b`, merged through [PR #7](https://github.com/PRADDZY/clickpe/pull/7). PR #6 contains the preceding rate-quote fix.
- The public `/health` endpoint reports revision `3d68ba0d937012817fb79dafc19f682e0a413a2b` and `status=ok`; the private EC2 API and all host containers also reported healthy after rollout.
- The rollout preserved EC2 instance `i-022165dd937251bd9`. SSM completed successfully; API, database, n8n, relay, runner and web containers were healthy.
- **All three workflows are active.** The temporary discovery verification workflow was deleted after the check.
- Notification mode is **preview**. The host has two controlled recipients configured, and the dedicated SES role assumption was verified.
- The stack is public for the demo and continues to incur AWS charges while it exists.

## Automated checks

- [PR #6 CI](https://github.com/PRADDZY/clickpe/actions/runs/38952936949) and [PR #7 CI](https://github.com/PRADDZY/clickpe/actions/runs/38957557049): backend, deployment-tools, and frontend jobs all passed.
- `uv run pytest -q --basetemp .runtime/pytest-final --tb=short` passed all runnable local cases; PostgreSQL integration cases were skipped because no disposable test database was configured. `uv run ruff check .`, workflow JSON parsing and `git diff --check` passed.
- [Isolated matching benchmark](https://github.com/PRADDZY/clickpe/actions/runs/38914198384): all 500,000 decisions and ordered explanations matched the frozen previous evaluator. It eliminated 75.96% of JavaScript candidates; this component benchmark excludes persistence and n8n orchestration.

## Visible 10,000-row run

Headed Playwright verified the hosted UI and uploaded the supplied CSV in Preview mode. Run `dbc3c908-6ef6-4e2d-ae02-b755321de963` completed with 10,000 profiles, two pinned products and 20,000 decisions.

- 2,281 applicants matched; 7,719 needed review; none were left unmatched or processing.
- SQL rejected 6,611 product pairs before the candidate evaluator and sent 13,389 to JavaScript, a 33.06% reduction in candidate work.
- Matching took **42.14 seconds**. This is matching time only; upload and import time are excluded.
- All 2,281 applicant notifications were previews; zero were sent.
- Navigation, refresh recovery, result filters, 25/50 pagination, drawer keyboard behavior, 390-pixel layout, and a simulated upload-signing failure were checked in visible Chrome.

This run used runtime revision `41f0ff2`; the final deployment changed discovery extraction only. Matching and notification behavior was not changed by PR #7.

## Live policy discovery

On 17 October, the deployed discovery workflow was run through a temporary manual trigger built from the actual active workflow. The normal daily schedule was left unchanged, and the temporary workflow was removed afterward.

- Both configured official lender pages were fetched.
- The selected free OpenRouter model was used. The execution exited successfully and created a pending Bajaj Finance proposal with model `nvidia/nemotron-3-super-120b-a12b:free`.
- It proposed `Starting from 10% p.a.` and cited `Interest rate: Starting from 10% p.a.*`. The quoted text is present verbatim in the fetched source excerpt.
- The proposal returned all eligibility rules as unknown and no evidence items. It remains `pending_review`; it was **not approved**, and the active catalogue did not change. The existing curated policy remains in force. Do not present this proposal as complete eligibility extraction.
- A previous Axis Bank proposal also remains pending. Its evidence text contains source excerpts, but the extracted matching rules are unknown. An operator should inspect both official pages before deciding whether to reject or replace these proposals.

PR #6 fixed the source-rate bug found during the first live attempt. Rates are now enumerated from literal source text, including shared-percent and “between … and …” ranges; unit matching cannot take `pa` from a word such as “payable.” Both provider validators choose a source quote containing the selected literal rate. The API still rejects rate quotes not found in the source excerpt.

PR #7 adds a deterministic score guard to the deployed discovery workflow. It captures clear required or preferred minimums, accepts inclusive `>=` / `≥`, and keeps negated, strict, upper-bound, or multi-threshold clauses unknown with a verbatim source quote and a review limitation. The existing pending proposals were not re-extracted because their source excerpts had not changed; no active product policy was modified. Regression coverage exercises both provider validators.

The paid OpenRouter model was unavailable due to the account's lack of credits. The user selected the free OpenRouter model. A private availability probe returned a successful zero-cost structured response. Gemini authentication succeeded, but the earlier live fallback attempt received a provider 503; Gemini was not needed in the final successful run and is not claimed as exercised successfully.

## Controlled SES demonstration

- SES verified the controlled sender and both user-owned Gmail plus aliases in `ap-south-1`.
- Headed Chrome uploaded three invented eligible applicants for run `a21cde4c-0831-4436-b1e9-db21ae668e93`. All three matched and the delivery ledger recorded **3 sent, 0 pending, 0 needing attention**.
- Ledger routing used both aliases: two messages to one alias and one to the other.
- The user confirmed all three personalized messages arrived and that both aliases were shown. This completes the assignment's test-alias requirement. Inbox placement is not claimed.
- The earlier base-address run `b29cae53-27cd-442f-bceb-6f42e48e6c02` also had three received messages, which the user reported arrived in Spam.
- Test delivery defaults to three messages per run and a 180-message rolling daily budget. All test destinations come from the controlled allowlist, never from the CSV. Preview mode has been restored.

## Remaining submission handoffs

The n8n owner setup is incomplete. The setup form is open in a visible headed browser through the active Session Manager tunnel. The user must create their own private owner password; passwords are not requested or stored here.

Still needed for the assignment's final submission:

1. Finish n8n owner setup, then record the required 5–10 minute end-to-end walkthrough and show one received synthetic email. A detailed narration script is saved locally as `.runtime/submission-demo-script.md` and is intentionally ignored/uncommitted.
2. Add the four requested GitHub reviewers. The user previously deferred the invites; none have been sent.
3. Submit the private repository URL and recording URL through the [assignment form](https://docs.google.com/forms/d/e/1FAIpQLSe1ET4U8rOcPM3VGJ8fT5HhigTO9fKuDlsB_wHtB5acWys9XQ/viewform).

The repository and hosted service are ready. The video, reviewer access, owner setup, and form submission are not yet complete.
