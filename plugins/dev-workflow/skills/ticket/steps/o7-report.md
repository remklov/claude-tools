# O7 Handle the report

Read the implementer's report only with:

```bash
cw report show --task <id>
```

It prints the status, the commits, the checks result, the holding proofs, each acceptance criterion with its evidence, risks, open points, warnings and `Next:`.

No report yet (exit 3): its `Fix:` says what to do. If the agent ended without saving one, SendMessage the same agent the printed text; if it is gone or belongs to an earlier session, `cw task start --task <id> --new-agent` gives a fresh implementer for the same round (then `cw task agent`).

## done

Look at the report before the review: every acceptance criterion met with evidence, checks `pass` and current, proofs for the new tests (a bug fix needs the regression proof). Warnings about stale or missing proofs are review material; the reviewer rechecks them. Continue with O8.

## blocked

The report holds `question` and `needed`.

1. Answer from the spec and the code if you can. If the answer needs the user (a dependency, a contract change, a product decision), ask with AskUserQuestion.
2. If the answer changes or sharpens the spec, save it first: `cw spec save --task <id>` with the whole updated spec, then `cw spec lint --task <id>`. The implementer brief is rewritten.
3. Send the answer as `cw` prints in `Next:`: a SendMessage to the same implementer with the answer (and, after a spec change, that the spec and its brief changed), or, for an agent of an earlier session, `cw task start --task <id> --new-agent` and a fresh Agent call.
4. Wait for the agent's answer, then `cw report show --task <id>` again.

A dependency the user approved: write the approval into the spec (the reviewer accepts the dependency script's finding with it), let the user install it in the work tree (agents may not install), and tell the implementer to commit the manifest and lockfile changes.

## misclassified

The report holds `reason` and `suggested`. The implementer has stopped before expanding the scope.

1. `cw classify --task <id>`: it classifies again and prints the old and the suggested level.
2. Tell the user the old and the new complexity and the implementer's reason.
3. `cw classify --task <id> --set <c> --why "<one sentence>"`; pick the higher level when in doubt.
4. `cw task reset --task <id>`: it removes the empty start or refuses (dirty work tree, commits on the branch, a branch cw did not create). On a refusal ask the user: keep the committed work and continue the branch with `cw task reset --task <id> --keep --note "<the user's decision>"`, or let the user clean up and run the reset again, or stop.
5. Confirm if the new level needs it (O5), then O6: `cw task start --task <id>` starts the implementer of the new level.

Details and the reset table: `cw playbook read reference/recovery.md`.
