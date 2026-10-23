# 0007 The orchestrator reads the ticket skill's files with `cw playbook read`

- Status: accepted, 2026-10-21 (automated dry run of P3)

## Context

The ticket skill keeps its details in `steps/` and `reference/`, which the orchestrator read with the Read tool by absolute path. The plugin lies outside the project, and the Read tool asks before a file outside the working directory (code.claude.com/docs/en/permissions): once per directory in the asking mode.

## Decision

`cw playbook read steps/<file>|reference/<file>` prints a file of the ticket skill, and the skill names its files that way. `Bash(cw *)` allows it.

## Consequences

- No read prompt for the playbook in any mode.
- `tests/unit/skills.test.mjs` checks that every file named this way exists and that every step and reference file is named.
