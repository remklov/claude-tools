# Architecture decision records

The architecture decisions D1 to D12 of the first build are in `docs/PLAN.md` §4, with the details of each phase in the "Decided in P2", "Decided in P3" and "Decided in P4" lists. The records here are the owner decisions taken during the build that changed or extended that plan. Each names its date, what led to it and what follows from it.

| Record | Decision |
|---|---|
| [0001](0001-in-place-git-form.md) | In-place git commands use the relative `git -C <appRoot>` form, with allow rules from `cw init` |
| [0002](0002-orchestrator-edit-scope.md) | G-ORCH-EDIT refuses edits of the project's files only |
| [0003](0003-background-agents.md) | Workflow agents may run in the background; the orchestrator waits for their report |
| [0004](0004-scratchpad-hand-over.md) | Text for `cw` goes through a scratchpad file; the reviewer may write that file |
| [0005](0005-read-only-git-rules.md) | `cw init` allows the read-only `git -C` commands |
| [0006](0006-persistent-cd-guard.md) | Guard G-CD refuses a `cd` that stays; commands stay plain |
| [0007](0007-skill-files-through-cw.md) | The orchestrator reads the ticket skill's files with `cw playbook read` |
| [0008](0008-commit-lint.md) | `cw git lint` is `cw commit lint` |
| [0009](0009-ticket-sources.md) | Tickets come from Jira, Linear or local files (`tickets.source`, `tickets.contextPath`) |
| [0010](0010-remklov-marketplace.md) | The remklov marketplace: local tickets by default, Jira through Atlassian's plugin, preset `default`, GitHub |

A new record takes the next number, the format of the existing ones and a line in this table.
