# 0002 G-ORCH-EDIT refuses edits of the project's files only

- Status: accepted, 2026-10-20 (owner decision during P3)

## Context

While a task runs, the main session is the orchestrator and delegates every change to the implementer (D3). A guard that refused every Edit and Write would also block files outside the project that Claude Code itself uses, such as its memory, and later the scratchpad of [0004](0004-scratchpad-hand-over.md).

## Decision

G-ORCH-EDIT refuses Edit, Write and NotebookEdit in the session that owns an active task only for paths inside the project: the config root, the work repo and the main checkout. The path is taken literally, so a `$` in a route file name is a character, not an expansion. Files outside the project pass.

## Consequences

- The orchestrator can write its hand-over files to the session scratchpad.
- The refusal names `cw task end` as the way out, after asking the user.
