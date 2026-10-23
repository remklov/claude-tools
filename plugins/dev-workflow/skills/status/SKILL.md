---
name: status
description: Show where the dev-workflow tasks of this project stand (phase, complexity, rounds, branch, PR/MR) from cw task list and cw task show. Use when the user asks about the state of a workflow task or ticket.
argument-hint: "[TICKET-KEY | NO-TICKET | all]"
---

# Task status

Arguments: $ARGUMENTS

Read-only: this skill never changes a task. To continue a task, the user runs `/dev-workflow:ticket <KEY>` (in another session it offers to take the task over).

## 1. List

- No argument: `cw task list` (the active tasks).
- A ticket key: `cw task list --ticket <KEY>`; `NO-TICKET` lists the active no-ticket tasks.
- `all`: `cw task list --all` (the ended tasks too, with their outcome in `cw task show`).

"No tasks." means no task is active. Exit 3 with "No .claude/dev-workflow/config.json" means the project is not set up for the workflow: point the user to `/dev-workflow:doctor` and the setup script.

## 2. Details

For each listed task (at most five; ask before showing more) run `cw task show --task <id>`. It prints the ticket and title, phase, complexity, implementer round and review round, branch, base, work tree and the PR/MR link.

## 3. Summarize

One line per task, in the user's language:

`<ticket> · <title> · <phase> · <complexity> · round <n>, review round <m> · <PR/MR link or branch>`

Then one sentence on what happens next, by phase:

| Phase | Next |
|---|---|
| spec | the orchestrator writes or lints the spec |
| classify, confirm | the complexity is being chosen or waits for the user's confirmation |
| implement | the implementer works, or its report waits to be read |
| review | the reviewer works, or its review waits to be read |
| deliver | approved; push and PR/MR wait for the user's confirmation |
| escalated | the review rounds ran out; the user decides how to continue |

If the `owner` column of `cw task list` shows another session, say that the task belongs to an earlier or another session and that `/dev-workflow:ticket <KEY>` offers to continue it here.

Do not read reports, reviews or state files beyond these two commands; the orchestrator reads them in its own session.