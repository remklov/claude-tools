# 0008 `cw git lint` is `cw commit lint`

- Status: accepted, 2026-10-22 (dry run in worktree mode)

## Context

In a worktree-isolated implementer, Claude Code's isolation refused `cw git lint --task <id>`: it reads the word `git` after `cw` as a git command it cannot confine to the worktree (CLI 2.1.308). `cw commit msg`, `git commit -F` and `cw prove` passed.

## Decision

The command is `cw commit lint`, next to `cw commit msg`. The playbooks, the fix texts, PLAN and the tests use the new name. `cw git foreign-commits` keeps its name: only the orchestrator runs it, without isolation.

## Consequences

- No alias: the old name is gone before the first release.
- `cw report save` still refuses a done report whose commits break the conventions.
