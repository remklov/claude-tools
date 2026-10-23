# O8 Review loop

Goal: an approved review at the branch tip, or an escalation to the user.

## 1. Foreign commits

```bash
cw git foreign-commits --task <id>
```

Exit 1 means the task branch holds commits that are not this task's, or the work tree left the branch. The `Fix:` names a git command for the implementer (a rebase or a switch). SendMessage the same implementer: run exactly that command, then `cw checks --changed --task <id>`, and save the report again with `cw report save --task <id>`. Wait, run `cw report show --task <id>`, then this check again. Interleaved foreign commits: ask the user. An implementer of an earlier session gets no SendMessage; follow the `Fix:` (the review turns it into a blocking finding).

## 2. Start the review round

```bash
cw task review --task <id>
```

- First round: it prints the Agent call for `dev-workflow:reviewer`. Pass it exactly (O6 rules), then `cw task agent --task <id> --role reviewer --id <agentId>`.
- Later rounds: it prints a SendMessage to the same reviewer with exactly the text to send. Send it unchanged and wait for the answer.
- A reviewer that is gone: `cw task review --task <id> --new-agent` prints a fresh Agent call.

## 3. Read the review

```bash
cw review show --task <id>
```

- **approved:** continue with O9. Non-blocking findings that stay open go into the PR/MR's open points.
- **changes_requested:** send the findings back:

  ```bash
  cw task return --task <id>
  ```

  It prints a SendMessage to the same implementer with the blocking findings and the ones marked "also" (`sendAlong`), or a fresh Agent call when that implementer is gone (`--new-agent`). Send it, wait, then back to O7 (`cw report show --task <id>`) and from there to this step.
- **escalated:** the last allowed round (`workflow.maxReviewRounds`) still requests changes. Show the user the open blocking findings and ask: continue with their decision, or stop.
  - Continue: `cw task return --task <id> --continue --note "<the user's decision>"`; the decision reaches the implementer.
  - Stop: `cw task end --task <id> --outcome escalated --note "<why>"`, then `cw task cleanup --task <id>` and the short report.

## Spec change during the loop

While the implementer works or the review is open, the spec cannot change; wait for the result. After an approval (until delivery) or an escalation: `cw spec save --task <id>`, `cw spec lint --task <id>`, then `cw task return --task <id> --spec-changed --note "<what changed>"`. That starts a new cycle with review round 0.

## The branch moved after the approval

If commits land after an approval (for example the user asked for a late fix), `cw task review --task <id>` starts a new review round over the commits since the approved head. Every `pr` command of `cw` refuses an approval that is not at the branch tip.
