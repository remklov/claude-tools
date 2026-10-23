# 0006 Guard G-CD refuses a `cd` that stays; commands stay plain

- Status: accepted, 2026-10-21 (automated dry run of P3)

## Context

The Bash working directory persists between calls (observed, CLI 2.1.306). An implementer ran `cd <src dir> && sed -i …`, after which the printed `git -C app` form no longer fit. Agents also chained commands with shell variables and loops, which Claude Code cannot check and asks about, and cut `cw` output with `head` or `tail`.

## Decision

G-CD refuses a `cd` or `pushd` that stays, for the session that owns an active task and for the workflow agents. A `cd` inside a `( … )` subshell, a `$(…)` or a `bash -c` script passes. The playbooks ask for plain commands with literal ids and paths, no shell variables, loops or `$(…)`, output read to its end, and file changes only through Edit and Write.

## Consequences

- An agent runs one command in a package directory as `(cd <dir> && <command>)`.
- A normal session without a task changes its directory freely.
