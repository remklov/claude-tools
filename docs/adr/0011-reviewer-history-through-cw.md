# 0011 The reviewer reads history through `cw`, not `git -C .claude/worktrees/*`

- Status: accepted, 2026-10-23 (Claude Code warning at session start in fisko)

## Context

[0005](0005-read-only-git-rules.md) gave the worktree-mode reviewer allow rules such as `Bash(git -C .claude/worktrees/* diff *)`, because the worktree name is random. Claude Code warns about them: a `*` in front of the subcommand also matches options inserted there, and for git options such as `-c` or `--exec-path` run arbitrary commands, which the rule would approve without a prompt.

## Decision

`cw init` writes no `git -C` allow rule in worktree mode. The reviewer reads the history with `cw review diff`, `cw review log` (with `--rev <commit>[:<path>]` for one commit or one file) and `cw review status`, in both modes. They run fixed read-only git arguments (`--no-pager`, `--no-ext-diff`, `--no-textconv`) in the task's recorded work tree; a revision must be a name, never an option, and paths go after `--`. `Bash(cw *)` covers them, so they need no prompt.

## Consequences

- The in-place rules `git -C <appRoot> …` stay: their `*` comes after the subcommand.
- Projects set up with an older `cw init` remove the `Bash(git -C .claude/worktrees/* …)` entries from `.claude/settings.json` by hand; `cw init` only adds.
- The reviewer's brief and role context name the `cw review` commands instead of a git form.
