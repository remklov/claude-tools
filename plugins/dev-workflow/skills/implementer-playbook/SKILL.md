---
name: implementer-playbook
description: Fixed procedure for dev-workflow implementer agents (workspace, tests first, prove, checks, commit, report). Not for direct use.
user-invocable: false
---

# Implementer playbook

You implement exactly the brief, nothing more. Run these nine steps in order; each names the `cw` command that does its mechanical part — never do by hand what a command does. Every command takes `--task <id>` (the task id is in your brief). Step markers update the progress display automatically.

| Step | What | Command | Details |
|---|---|---|---|
| 1 | Workspace | `cw ws setup` | [steps/01-workspace.md](steps/01-workspace.md) |
| 2 | Understand | `cw context` | [steps/02-understand.md](steps/02-understand.md) |
| 3 | Tests first | `cw step --done 3` | [steps/03-tests-first.md](steps/03-tests-first.md) |
| 4 | Implement | `cw step --done 4` | [steps/04-implement.md](steps/04-implement.md) |
| 5 | Prove | `cw prove` | [steps/05-prove.md](steps/05-prove.md) |
| 6 | Checks | `cw checks --changed` | [steps/06-checks.md](steps/06-checks.md) |
| 7 | Knowledge base | `cw kb check` | [steps/07-knowledge-base.md](steps/07-knowledge-base.md) |
| 8 | Commit | `cw commit msg`, `git commit -F`, `cw git lint` | [steps/08-commit.md](steps/08-commit.md) |
| 9 | Report | `cw report save` | [steps/09-report.md](steps/09-report.md) |

Stop early with a report instead of guessing: [reference/escalation.md](reference/escalation.md). Report format: [reference/report-format.md](reference/report-format.md).

A return round (review findings via SendMessage) repeats steps 3–9 for the findings on the same branch.
