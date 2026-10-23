# Off the happy path

Every case starts the same way: read the whole `cw` output, do what its `Fix:` or `Next:` says, and ask the user where it hands a decision to them. Never repair task state by hand.

## A task of an earlier session (rebind)

A task belongs to the session that ran `cw task new`. `/clear`, a new session or a forked session has a new session id, so the edit guard and the agents' records no longer match it.

1. `/dev-workflow:ticket <KEY>` in the new session finds the active task in O1 (`cw task list --ticket <KEY>`).
2. Ask the user whether to continue it here. With a yes: `cw task new --rebind <id>`. The no-ticket key is never rebound without the user picking the task from `cw task list --ticket NO-TICKET`.
3. The output names the task's phase, the next command, and the agents of the earlier session. Continue at the step of that phase ("Where you are" in the skill) with that command.
4. Agents of the earlier session get no SendMessage. `cw` prints fresh Agent calls instead: `cw task start --task <id> --new-agent` (implementer in implement), `cw task review --task <id> --new-agent` (reviewer), and `cw task return --task <id> --new-agent` (implementer after a review). Its `Next:` lines already carry `--new-agent` where it is needed.

## An agent that is gone

The Agent call was refused or failed, the agent ended without a report, or its worktree is gone.

- No report: `cw report show --task <id>` exits 3 and its `Fix:` says what to send the same agent, or to start a fresh one with `cw task start --task <id> --new-agent` (only while the round has no report or a blocked one).
- No review: `cw review show --task <id>` names the SendMessage or `cw task review --task <id> --new-agent`.
- A fresh Agent call is always followed by `cw task agent --task <id> --role <implementer|reviewer> --id <agentId>`.
- The SubagentStop hook keeps an agent running (at most twice) until it has saved its report or review; an agent that still ends without one is gone.

## Misclassified and the reset

After the new classification (O7: `cw classify --task <id>`, then the level with `--set`), `cw task reset --task <id>` decides by the state of the work tree:

| State | What `cw task reset` does |
|---|---|
| Branch missing, work tree clean on the base | nothing to do |
| Branch exists, clean, no commits (worktree mode: a clean worktree without commits) | removes the branch (and the worktree) |
| Uncommitted changes, commits on the branch, or a branch cw did not create | refuses with exit 3 |

On a refusal ask the user. Keep the committed work and let the new implementer continue the branch: `cw task reset --task <id> --keep --note "<the user's decision>"` (still refused with uncommitted changes). Otherwise the user cleans up and the reset runs again, or the task stops. `cw task start` refuses until the reset ran.

## A spec change

| Phase | What to do |
|---|---|
| spec, classify, confirm | `cw spec save`, `cw spec lint`; the task returns to spec, so classify (O4) and confirm (O5) again |
| implement, report blocked | `cw spec save`, `cw spec lint`, then what `cw` prints: the answer to the same implementer, or a fresh one |
| implement (working), review (open) | not possible: wait for the report or the review |
| review (approved), deliver, escalated | `cw spec save`, `cw spec lint`, then `cw task return --task <id> --spec-changed --note "<what changed>"`; a new cycle starts |

A changed spec after an approval blocks every `pr` command of `cw` and `cw task end --task <id> --outcome done` until `cw task return --task <id> --spec-changed --note "<what changed>"` ran.

## Foreign commits

`cw git foreign-commits --task <id>` exits 1 when the branch holds commits of other work, or the work tree left the branch. Send the printed command to the same implementer, with the request to rerun `cw checks --changed --task <id>` and save the report again. Interleaved foreign commits cannot be rebased away: ask the user.

## The escalation

`cw review show` moves the task to escalated when the last allowed review round still requests changes. Show the user the open blocking findings and ask:

- continue: `cw task return --task <id> --continue --note "<the user's decision>"`;
- change the spec: `cw spec save`, `cw spec lint`, `cw task return --task <id> --spec-changed --note "<what changed>"`;
- stop: `cw task end --task <id> --outcome escalated --note "<why>"`, then `cw task cleanup --task <id>`.

## A refused command

- Exit 2 (usage): the command line is wrong; correct it from `Fix:`. `cw help` with the command's words prints its usage, for example `cw help task return`.
- Exit 3 (precondition): the task is not where the command needs it. `Fix:` names the command that gets it there, or the decision to ask the user for.
- Exit 1 (failed): a lint or validation found problems; each line names one.
- Exit 4 (internal): show the user the message; do not retry blindly.
- A guard refusal (a hook deny) names the alternative: use it. Never retry the same call in another form.

## Aborting

When the user drops the task: `cw task end --task <id> --outcome aborted --note "<the user's reason>"`, then `cw task cleanup --task <id>` (in-place: the app back on its base; worktree: the clean worktree removed). The task branch stays; mention it in the short report.
