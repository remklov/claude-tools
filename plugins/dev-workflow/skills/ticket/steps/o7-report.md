# O7 Handle the report

When the implementer has ended, run one command (ADR 0014):

```bash
cw task review --task <id>
```

- **A done report:** it prints the report (status, commits, checks, holding proofs, each acceptance criterion with its evidence, risks, open points, warnings), checks that the task branch holds only this task's commits, and starts the review round with the reviewer's Agent call or SendMessage. Look at the report as you pass the call on: warnings about stale or missing proofs are review material; the reviewer rechecks them. Continue with O8 §2.
- **Foreign commits or a work tree off the branch (exit 1):** its `Fix:` names the git command for the implementer (a rebase or a switch). SendMessage the same implementer: run exactly that command, then `cw checks --changed --task <id>`, and save the report again. Wait, then `cw task review --task <id>` again. Interleaved foreign commits: ask the user. An implementer of an earlier session gets no SendMessage: the review goes on and turns it into a blocking finding.
- **Another status (exit 3):** read the report with `cw report show --task <id>`; the sections below.
- **No report yet (exit 3):** its `Fix:` says what to do. If the agent ended without saving one, SendMessage the same agent the printed text; if it is gone or belongs to an earlier session, `cw task start --task <id> --new-agent` gives a fresh implementer for the same round.

## blocked

The report holds `question` and `needed`.

1. Answer from the spec and the code if you can. If the answer needs the user (a dependency, a contract change, a product decision), ask with AskUserQuestion.
2. If the answer changes or sharpens the spec, save it first: `cw spec save --task <id>` with the whole updated spec, then `cw spec lint --task <id>`. The implementer brief is rewritten.
3. Send the answer as `cw` prints in `Next:`: a SendMessage to the same implementer with the answer (and, after a spec change, that the spec and its brief changed), or, for an agent of an earlier session, `cw task start --task <id> --new-agent` and a fresh Agent call.
4. Wait for the agent's answer, then `cw task review --task <id>`.

A dependency the user approved: write the approval into the spec (the reviewer accepts the dependency script's finding with it), let the user install it in the work tree (agents may not install), and tell the implementer to commit the manifest and lockfile changes.

## misclassified

The report holds `reason` and `suggested`. The implementer has stopped before expanding the scope.

1. `cw classify --task <id>`: it classifies again and prints the old and the suggested level.
2. Tell the user the old and the new complexity and the implementer's reason.
3. `cw classify --task <id> --set <c> --why "<one sentence>"`; pick the higher level when in doubt.
4. `cw task reset --task <id>`: it removes the empty start or refuses (dirty work tree, commits on the branch, a branch cw did not create). On a refusal ask the user: keep the committed work and continue the branch with `cw task reset --task <id> --keep --note "<the user's decision>"`, or let the user clean up and run the reset again, or stop.
5. Confirm if the new level needs it (O5), then O6: `cw task start --task <id>` starts the implementer of the new level.

Details and the reset table: `cw playbook read reference/recovery.md`.
