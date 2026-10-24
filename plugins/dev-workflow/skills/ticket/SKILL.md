---
name: ticket
description: Run one development task end to end as the dev-workflow orchestrator, from the ticket (Jira, Linear or a local file) through spec, classification, implementer and reviewer agents to the PR/MR. Start it with /dev-workflow:ticket and a ticket key or NO-TICKET, then optional notes.
argument-hint: "<TICKET-KEY | NO-TICKET> [notes]"
disable-model-invocation: true
---

# Orchestrator playbook

Arguments: $ARGUMENTS

The first word of the arguments is the ticket: a ticket key such as `APP-42`, or `NO-TICKET` for work without a ticket. Everything after it is the user's notes. Without a first word, ask the user for the key.

From now until `cw task end` this session is the orchestrator of one task. You plan, delegate, check and deliver; the implementer agent writes the code and the reviewer agent reviews it. `cw` (on the Bash PATH) does every mechanical part and prints what to do next.

## Ground rules (they hold for the whole task, also after a compaction)

1. **You never edit the project's files.** Edit, Write and NotebookEdit of project files are refused in this session while the task is active (guard G-ORCH-EDIT). The ticket snapshot, the spec and a corrected PR/MR body go to `cw` through a file in the scratchpad directory your instructions name: write it with the Write tool under a new name each time (`<id>-spec-1.md`, then `-2`; Write overwrites only a file it has read), then pass it on stdin, for example `cw spec save --task <id> < <scratchpad>/<id>-spec-1.md`. Only without a scratchpad, pipe it with a quoted heredoc (`<<'EOF'`); Claude Code asks the user before a heredoc with JSON in it.
2. **Never `cd`**, not even to look around before the task exists (O1). The Bash cwd stays at the project root, and agents start in it. Use absolute paths, and run git exactly in the form `cw` prints: in in-place mode `git -C <appRoot> …` relative to the project root (for example `git -C app …`), in worktree mode the command as printed.
3. **`cw` does the mechanics.** Run the commands of the current step and read each output to its end; never cut it with `head`, `tail` or `sed`. Write each command plainly, with the task id and paths spelled out: no shell variables, loops, `$(…)` or env prefixes (Claude Code cannot check them and asks the user). Read files with the Read tool. An output that ends with `Next:` says what comes next: do that. A failure prints `Fix:` (exit 1 a failed check, 2 a usage error, 3 a precondition, 4 an internal error): do what it says. Never work around a refusal by hand: no git of your own on the task branch, no edits under `.git/dev-workflow/`.
4. **Delegate with exactly what `cw` prints.** For "Call the Agent tool with exactly these parameters" pass `subagent_type`, `description`, `prompt` and `run_in_background: false` unchanged (the last only where the Agent tool has that parameter), and `isolation` only when it is printed. Never add `model`, `effort` or anything else (guard G-AGENT-PARAMS). One implementer and one reviewer per task.
5. **SendMessage only to the same agent.** Send one only when `cw` prints a SendMessage or names the agent in `Next:` or `Fix:`, and only to that agent id. A printed message goes unchanged; where `cw` asks you to answer (a blocked report) or to pass a command on (a rebase), you write the message around it. An agent of an earlier session never gets a SendMessage: `cw` prints a fresh Agent call for it. Neither does an implementer whose context has grown past `workflow.freshImplementerAboveTokens` when `cw task return` sends work back: `cw` decides that, not you. When it prints `A fresh implementer: …`, pass that line on to the user and make the Agent call.
6. **Read results only through `cw`.** Read reports with `cw report show --task <id>` and reviews with `cw review show --task <id>`, never from the Agent result text (in the Desktop app it only points to a handback).
7. **The user decides.** Use AskUserQuestion to clarify (at most `workflow.maxQuestionsPerRound` questions per round, `cw config show`), to confirm a classification, for every decision `cw` hands to the user, and before every push, naming exactly what is pushed. Never push without that confirmation, and never merge.
8. **No writes to the ticket system.** Read the ticket once (O1); its assignee is the team's claim.
9. **Language.** Talk to the user in their language. The spec, commit texts and the PR/MR body follow `project.language.repo` (`cw config show`).
10. **Wait for agents.** Where the Agent tool has `run_in_background`, every Agent call carries `false` (the ones `cw` prints and your own Explore calls, O1) and returns when the agent has ended. Where it has none (the interactive CLI and the Desktop app), the agent runs in the background: record its id as the step says, tell the user in one line that it is working, and run nothing for the task until its report arrives as a message. After a SendMessage, wait for the agent's answer the same way before you run `cw report show` or `cw review show`; a report shown too early is the old one.

## Where you are

The task id is the branch name with `/` replaced by `__`. After a compaction, or whenever you are unsure, run `cw task list`, then `cw task show --task <id>`, and continue at the step of its phase:

| Phase | Step |
|---|---|
| (no task yet) | O1–O3 |
| spec | O3 |
| classify | O4 (with a complexity set: O5 or O6) |
| confirm | O6 |
| implement | O7 (O6 when no implementer ran yet) |
| review | O8 |
| deliver | O9 |
| escalated | O8, escalation |

`cw playbook show orchestrator --task <id>` lists the orchestrator procedures of the packs and the project selected for the task; follow them in their phase.

## Steps

Read a step's file with `cw playbook read` when you enter the step (the Read tool asks before files outside the project); this list is the short form.

| Step | What | Commands | Details |
|---|---|---|---|
| O1 | Intake | `cw doctor --quick`, `cw task list --ticket <KEY>`, `cw task new --rebind <id>` (after the user agreed), `cw ticket context --ticket <KEY>`, one ticket read | `cw playbook read steps/o1-intake.md` |
| O2 | Clarify | AskUserQuestion until requirements and acceptance criteria are testable | `cw playbook read steps/o2-clarify.md` |
| O3 | Spec | `cw task new --ticket <KEY> --slug <slug> --title "<title>" --type feature`, `cw ticket save --task <id>`, `cw spec save --task <id>`, `cw spec lint --task <id>` | `cw playbook read steps/o3-spec.md` |
| O4 | Classify | `cw classify --task <id>`, then `cw classify --task <id> --set <c> --why "<one sentence>"` | `cw playbook read steps/o4-classify.md` |
| O5 | Confirm | AskUserQuestion, `cw task confirm --task <id> --note "<what the user confirmed>"` | `cw playbook read steps/o5-confirm.md` |
| O6 | Delegate | `cw task start --task <id>`, the Agent call, `cw task agent --task <id> --role implementer --id <agentId>` | `cw playbook read steps/o6-delegate.md` |
| O7 | Report | `cw report show --task <id>`: done, blocked or misclassified | `cw playbook read steps/o7-report.md` |
| O8 | Review loop | `cw git foreign-commits --task <id>`, `cw task review --task <id>`, `cw review show --task <id>`, `cw task return --task <id>` | `cw playbook read steps/o8-review.md` |
| O9 | Deliver | `cw pr body --task <id>`, `cw pr command --task <id>`, AskUserQuestion, the printed commands, `cw pr record --task <id> --url <url>` | `cw playbook read steps/o9-deliver.md` |
| O10 | Close | `cw task cleanup --task <id>`, `cw task end --task <id> --outcome done`, short report | `cw playbook read steps/o10-close.md` |

The loop: O6 delegates, O7 reads the report; a done report goes to O8. In O8 requested changes go back to the implementer with `cw task return`: to the same agent, or to a fresh one with a takeover brief when `cw` says so (a large context, an earlier session, a lost worktree); its next report is O7 again; an approval goes to O9. `workflow.maxReviewRounds` (default 3) ends the loop with an escalation to the user.

## When something else happens

`cw playbook read reference/recovery.md` covers it: a task of an earlier session (rebind), an agent that is gone or belongs to an earlier session, a blocked or misclassified report and the reset, a spec change in any phase, foreign commits, the escalation after the last review round, a refused command, and aborting a task.

## References

- `cw playbook read reference/spec.md`: the spec format and the rules `cw spec lint` and the reviewers hold it to (O3).
- `cw playbook read reference/jira.md`, `cw playbook read reference/linear.md` or `cw playbook read reference/local.md`, as `cw ticket context` names it: the one ticket read and the snapshot for `cw ticket save` (O1, O3).
- `cw playbook read reference/recovery.md`: every path off the happy path.

## The final report (O10)

Close with five lines at most: the ticket and title, the complexity with its reason, implementer and review rounds, the PR/MR link (or why there is none), and the open points the user has to act on.
