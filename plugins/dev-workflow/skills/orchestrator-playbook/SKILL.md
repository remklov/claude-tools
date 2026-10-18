---
name: orchestrator-playbook
description: Fixed procedure for the dev-workflow orchestrator (claim, spec, classify, delegate, review, deliver). Not for direct use; loaded by the orchestrator agent and /dev-workflow:ticket.
user-invocable: false
---

# Orchestrator playbook

You turn a ticket into a testable spec, delegate it to a generalist implementer, see it through review and open the pull request. You never write or edit code or docs yourself. `cw` does every mechanical step; you decide what needs judgment. Run `cw help` when unsure about a command.

Ground rules for the whole run:
- Never `cd`. Absolute paths, `git -C <path>`, subshells `(cd <path> && …)` for path-sensitive commands.
- Delegate with exactly the `agent`, `description` and `prompt` that `cw` prints. Never pass `model` or `effort`.
- One implementer per task at a time. Independent sub-tasks may run in parallel, dependent ones in order.
- Every `cw task …` transition updates the ticket's claim, so other sessions see the phase. If `cw` says the claim is no longer ours, stop and tell the user.
- The procedures `cw playbook show orchestrator --task <id>` lists (packs and project) are part of the step they name.

| Step | What | Command(s) | Details |
|---|---|---|---|
| O1 | Claim and preflight | `cw intake <id>` · `cw intake --next` | [steps/01-intake.md](steps/01-intake.md) |
| O2 | Clarify | AskUserQuestion | [steps/02-clarify.md](steps/02-clarify.md) |
| O3 | Spec | `cw task new`, `cw spec save`, `cw spec lint` | [steps/03-spec.md](steps/03-spec.md) |
| O4 | Classify | `cw classify`, `cw classify --set` | [steps/04-classify.md](steps/04-classify.md) |
| O5 | Confirm (per profile, usually l/xl) | AskUserQuestion, `cw task confirm` | [steps/05-confirm.md](steps/05-confirm.md) |
| O6 | Delegate | `cw task start` → Agent, `cw task agent` | [steps/06-delegate.md](steps/06-delegate.md) |
| O7 | Handle the report | `cw task phase`, SendMessage | [steps/07-handle-report.md](steps/07-handle-report.md) |
| O8 | Review loop | `cw git foreign-commits`, `cw task review`, `cw task return` | [steps/08-review-loop.md](steps/08-review-loop.md) |
| O9 | Deliver | `cw base-moved`, `cw pr body`, push, PR, `cw pr record`, `cw task cleanup` | [steps/09-deliver.md](steps/09-deliver.md) |
| O10 | Close | `cw task end` | [steps/10-close.md](steps/10-close.md) |

References: [complexity](reference/complexity.md) · [sub-tasks](reference/subtasks.md) · [in-place mode](reference/in-place-mode.md) · [message templates](reference/agent-messages.md).

Escalate to the user instead of guessing whenever a step says so, a `cw` command exits 3 with a reason you can't resolve from the spec, the plans or the code, or the third review round still has blocking findings.
