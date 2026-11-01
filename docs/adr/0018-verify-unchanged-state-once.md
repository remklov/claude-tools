# 0018 The review verifies an unchanged state once

- Status: accepted, 2026-11-01 (fisko, 15 tasks of 2026-10-25 to 2026-11-01)

## Context

A small task took 10–15 minutes from the ticket command to its end, about 3 minutes of it in the reviewer. A big share of those minutes repeated what `cw` had just done:

- The reviewer ran `cw checks --changed` on the content the implementer's last run had passed. The run took a median of 93 s and appeared 23 times in the week, 28 minutes in all.
- `cw prove --recheck` re-ran each proof at the commit the implementer had proved it at: a median of 35 s, at most 3 minutes, 21 minutes in all.

`cw` runs both itself and records them:

- A checks result has the tree id of the work tree's content.
- A proof has the commit and the base it ran against.

At the same content and commit the repeat proves nothing new. It shows only flakiness.

## Decision

- **`cw checks --task <id>` reuses a recorded passing run** when it covers the same work tree content (tree id), the same selection (`--changed`, `--package`, all), the same `--only` list and the same check commands per package. It prints `Reused <file>` and records nothing new. That file is the current result for `cw report save` and `cw review save`. `--fresh` runs the checks again; a failing or older result is never reused.
- **`cw prove --task <id> --recheck` counts a proof without a run** when `cw` recorded it at the current commit and base and the work tree is clean. The recheck entry names it as reused. `--fresh` runs every proof again. A proof of an earlier commit runs as before.
- The reviewer playbook names both, and `--fresh` for a reason to doubt a run, such as a flaky test.

## Evidence

- **Sources.** The transcripts of the agents in fisko: the time from each `cw checks` and `cw prove` call to its result, 2026-10-25 to 2026-11-01. The task critical paths come from the same transcripts.

## Consequences

- A review round of an unchanged branch saves about two minutes in fisko, more with longer test suites.
- A flaky test passes the review on the implementer's run; the reviewer's `--fresh` remains the way to check it.
- An implementer that runs the checks again without a change gets the recorded run as well.
