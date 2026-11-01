# 0015 The user decides on defects the review does not block

- Status: accepted, 2026-11-01 (fisko, 15 tasks of 2026-10-25 to 2026-11-01)

## Context

An approval left every non-blocking finding to the PR/MR's open points, and nobody decided on them. A test of the workflow against a single-session workflow found a production defect among such findings, which would have gone into the merge request. Observation reported by a colleague; their tasks are not in these sources.

In fisko, approved reviews passed seven defects on as non-blocking `correctness` findings:

- **DGII-14:** a stored document with more than 8 decimals now answers 5xx instead of DUPLICATE. The change introduced it; the reviewer called it "narrow".
- **BILL-12:** an unreadable `expiresAt` aborts the run after the provider confirmed the order, and the order id is lost. The reviewer called it "unreachable with the stub".
- **BILL-13:** a `pending` binding stays `pending` after a capture with a stale revision.
- **BILL-14:** a second cancel answers 404 after 200, or cancels a manual membership. The reviewer wrote "the owner should decide", but nobody asked the owner.
- **BILL-21:** the audit trail says an invoice was queued when nothing was queued. The reviewer wrote "no production path today".
- **BILL-23:** a race with three writers that skip the business lock; it was there before the change.
- **BILL-28:** a new mix of the database and the JavaScript clock on one lease. The reviewer kept it non-blocking because the file was a non-goal.

Two of the seven became tickets. Two owner decisions came only after an approval and cost a whole round each: BILL-14's routing of R3 and R5 (round 3, 7.2 M cache reads), and BILL-28's clock fix. The reviewer playbook said "each defect is a blocking finding", but reviewers measured defects against the spec.

## Decision

- **Severity.**
  - A defect on a path the change adds or touches is blocking, also when it is narrow, unreachable today or behind a stub.
  - A defect outside the change (pre-existing, or in a non-goal) is non-blocking with `decision: true`.
- **Findings for the user.**
  - A finding carries `decision: true` when the user must decide: an ambiguous or contradicting spec, a ticket requirement the spec leaves out, a defect outside the change, or a fix beyond the spec. Its issue is the question, and its `suggestion` the recommendation (required). Unsure findings are asked this way instead of blocking.
  - `cw review show` marks these, and every non-blocking `correctness` or `security` finding, with "needs the user's decision".
- **`cw review decide --task <id> --finding <F>[,<F>] --as fix|ticket|accept --note "<answer>"`** records the answer in `task.json` (`decisions`, keyed by round, review round and finding).
- **Gates.**
  - `cw task return` refuses a review that requested changes while a marked finding is undecided, so the answers go back in the same round.
  - `cw spec save` is allowed then, and the returned round works from the new spec.
  - After an approval, `cw task return` sends the findings the user decided to fix.
  - Every `pr` command refuses an undecided finding or a fix that has not gone back.
- **Carried-over findings.**
  - The reviewer carries over every finding of its previous review that still holds, with `carriedFrom` set to its id; `cw review save` checks that id against the previous review.
  - A carried-over finding inherits the user's decision, so nobody is asked twice.
  - The PR/MR's open points come from the final review, labelled "Accepted by the user" or "Needs a ticket". `cw task end` lists the tickets the user wants.

## Evidence

- **Sources.** The review files (`review-<n>.json`) and task histories of fisko, and `plan/tickets/` for the follow-ups.
- **Tickets.** The search for the seven defects found BILL-28, from BILL-23's race, and a note in BILL-10, from BILL-14's double cancel. No ticket names the other five.
- **Round cost.** Measured as in [ADR 0013](0013-implementer-rules-check.md).

## Consequences

- A review with such findings costs one AskUserQuestion before the return or the delivery. A decision taken there saves the round that a decision after the approval costs.
- Reviewers report fewer non-blocking `correctness` findings, because each one reaches the user.
- A review of an earlier playbook has no `decision` and no `carriedFrom`. Its non-blocking `correctness` and `security` findings still need a decision. Its findings carried over in prose are asked again.
