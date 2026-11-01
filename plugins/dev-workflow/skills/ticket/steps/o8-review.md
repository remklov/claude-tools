# O8 Review loop

Goal: an approved review at the branch tip, or an escalation to the user.

## 1. The review round

`cw task review --task <id>` (O7) started it: the first round prints the Agent call for `dev-workflow:reviewer` (pass it exactly, O6 rules), later rounds a SendMessage to the same reviewer with exactly the text to send. A reviewer that is gone: `cw task review --task <id> --new-agent` prints a fresh Agent call. Wait for the reviewer.

## 2. Read the review

```bash
cw review show --task <id>
```

It marks the findings the user decides on (ADR 0015): `needs the user's decision` stands at every finding the reviewer set `decision` on and at every non-blocking `correctness` or `security` finding. No defect goes into the PR/MR unseen, and the answer reaches the implementer in this round.

- **Marked findings:** one AskUserQuestion with one question per finding (at most `workflow.maxQuestionsPerRound`, more in a second round): the finding in plain words with its file, and the options "Fix it in this task", "A ticket for later" and "Accept it as it is", the reviewer's recommendation first. Record each answer:

  ```bash
  cw review decide --task <id> --finding F2 --as fix --note "<the user's answer>"
  ```

  An answer that changes the spec (a routing decision, a sharper criterion): save the spec now, `cw spec save --task <id>` and `cw spec lint --task <id>`; the returned round works from it. `cw task return` and every `pr` command refuse while a marked finding has no decision.
- **approved:** without a fix decision continue with O9; the accepted findings and the ones left for a ticket go into the PR/MR's open points. With a fix decision: `cw task return --task <id>` sends those findings back, and the round goes on as below.
- **changes_requested:** send the findings back:

  ```bash
  cw task return --task <id>
  ```

  It prints a SendMessage to the same implementer with the blocking findings, the ones the user decided to fix and the ones marked "also" (`sendAlong`), or a fresh Agent call when that implementer is gone (`--new-agent`), belongs to an earlier session, or its context is larger than `workflow.freshImplementerAboveTokens` (default 150000 tokens). The fresh agent's brief carries the spec, the handover of the last report, the findings and the branch state, so it needs nothing from the old one. Do exactly what is printed. Tell the user the one-line reason `cw` prints (`A fresh implementer: …`, or that the context size is unknown). Wait, then `cw task review --task <id>` (O7).
- **escalated:** the last allowed round (`workflow.maxReviewRounds`) still requests changes. Show the user the open blocking findings and ask: continue with their decision, or stop.
  - Continue: `cw task return --task <id> --continue --note "<the user's decision>"`; the decision reaches the implementer.
  - Stop: `cw task end --task <id> --outcome escalated --note "<why>"`, then `cw task cleanup --task <id>` and the short report.

## Spec change during the loop

While the implementer works or the review is open, the spec cannot change; wait for the result. After an approval (until delivery) or an escalation: `cw spec save --task <id>`, `cw spec lint --task <id>`, then `cw task return --task <id> --spec-changed --note "<what changed>"`. That starts a new cycle with review round 0.

## The branch moved after the approval

If commits land after an approval (for example the user asked for a late fix), `cw task review --task <id>` starts a new review round over the commits since the approved head. Every `pr` command of `cw` refuses an approval that is not at the branch tip.
