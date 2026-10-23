# 0001 In-place git commands use `git -C <appRoot>`

- Status: accepted, 2026-10-20 (owner decision after P2)
- Implemented in P3

## Context

In the in-place mode the application is a nested repository (for example `app/`) inside the project that holds the config. Agents run with the project root as their Bash working directory. `Bash(git add *)` and `Bash(git commit *)` do not match a `git -C … add` command, because Claude Code matches the command text as written (code.claude.com/docs/en/permissions), so every commit of an implementer asked for permission.

## Decision

`cw` prints every in-place git command as `git -C <appRoot> …`, relative to the project root, in one form (`gitForm`): the brief, `cw context`, `cw commit msg`, the fixes of `cw commit lint` and `cw prove`, `cw git foreign-commits`, the SubagentStart context and the push of `cw pr command`. `cw init` writes `Bash(git -C <appRoot> add *)` and `Bash(git -C <appRoot> commit *)` for an `appRoot` that needs no shell quoting, and a warning for one that does.

## Consequences

- The form the agents run equals the form the allow rules match; a variant such as `git -C ./app add` still asks.
- The push keeps its ask rule `Bash(git -C * push *)`.
- Extended by [0005](0005-read-only-git-rules.md) to the read-only commands.
