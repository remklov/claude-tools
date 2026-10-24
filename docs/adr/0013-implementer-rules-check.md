# 0013 The implementer checks its change against the applicable rules

- Status: accepted, 2026-10-25 (seven tasks in fisko)

## Context

Four of seven tasks in fisko needed a second review round. In three of them the only blocking findings of round 1 were rule findings that a careful reading of the diff catches:

- CORE-NAMING, twice: the abbreviations `RE` and `pow10`, and `i` as the name of an item.
- TS-NO-CAST and CORE-SIMPLICITY together: non-null assertions in a test, and a helper with two call sites.

The fourth was a judgement about test coverage: an acceptance criterion without a page test.

Each of the three rounds cost 2.5–3.6 M cache reads, 16–29 % of its task, and 5–10 minutes. The orchestrator had the largest share, 1.0–2.1 M, because by then it ran at 130–300k tokens.

The implementers had the rules:

- Claude Code put `00-global.md`, with the full text of CORE-NAMING (its list of allowed abbreviations included) and CORE-SIMPLICITY, into the agent's instructions at its start.
- It added the path-scoped rule files, `paths-typescript-1.md` with TS-NO-CAST among them, once the agent read files of the package.
- `cw context` printed `cw rules applicable --task <id>` as the first `Next:` command.

None of the four implementers of round 1 ran that command. The reviewer checks every rule against the diff (R4), and it found the violations. The rules were known, but nobody checked the change against them before the review.

## Decision

- **Step 4 ends with the rules check.**
  - After the change and before the checks, the implementer runs `cw rules applicable --task <id>` and goes through each rule against the lines it added or changed, as the reviewer does in R4.
  - It fixes each violation then, so the fix needs no extra checks run, commit or proof.
  - A rule the spec overrides on purpose (never a protected one) goes into `handover.deviations`.
- **The report records it.**
  - A report carries `rulesChecked`, the IDs of the rules the change was checked against.
  - For a done report, `cw report save` requires exactly the IDs of `cw rules applicable` at save time and names the missing and the extra ones. This is the same check as in `cw review save`.
  - The saved report keeps both lists, `rulesChecked` and `rulesApplicable`.
  - A blocked or misclassified report is not held to the rules: it may stop before there is a change.
- **The reviewer still checks every rule itself.** The implementer's list is no evidence for the review.

## Evidence

- **fisko, seven tasks of 2026-10-23 and 2026-10-24.** Sources: the task files (`report-<n>.json`, `review-<n>.json`) and the Claude Code transcripts of the orchestrator and the agents.
  - Approved in review round 1: 3 of 7.
  - The cost of a second round is every API call of the three roles between the saves of `review-1.json` and `review-2.json`, with cache reads counted as in [ADR 0012](0012-fresh-implementer-above-context.md).
- **Observation, Desktop app 2.1.308 (three of the tasks) and interactive CLI 2.1.309 (one task).**
  - The implementer transcripts hold `00-global.md` as an instructions attachment at the start, and the path-scoped rule files as nested memory attachments once the agent read files under `fisko-api/`.
  - No implementer transcript has a `cw rules applicable` call.

## Consequences

- A done report written for an earlier playbook is refused once with `rulesChecked is empty: …`. The implementer runs the command, checks the change and saves again.
- The check costs the implementer a few calls per round, and it pays off when it saves a review round. The measure is the share of tasks approved in review round 1: 3 of 7 before this change.
- The set of applicable rules grows with the changed files. A file type added after the check brings new rules, and `cw report save` names them.
