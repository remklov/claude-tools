# 0005 `cw init` allows the read-only `git -C` commands

- Status: accepted, 2026-10-21 (automated dry run of P3); the worktree-mode rules are superseded by [0011](0011-reviewer-history-through-cw.md)

## Context

Claude Code runs read-only git commands without a prompt only in their plain form; `git -C app diff` asked, for the orchestrator (`ls-files`, the current branch) and for the reviewer (`diff`, `log`, `status`, `show`). In worktree mode the reviewer reads the implementer's worktree with `git -C .claude/worktrees/<agent> …`.

## Decision

`cw init` adds allow rules for `git -C <appRoot>` with `status`, `diff`, `log`, `show`, `ls-files`, `rev-parse` and `branch --show-current` in the in-place mode, and the same read-only commands for `git -C .claude/worktrees/*` in worktree mode. A trailing ` *` also matches the bare command (code.claude.com/docs/en/permissions). The reviewer's brief names only the relative worktree path for git.

## Consequences

- Extends [0001](0001-in-place-git-form.md).
- `git -C <appRoot> diff --output=<file>` could write; the sandbox and G-REVIEWER-WRITE stay the backstop.
