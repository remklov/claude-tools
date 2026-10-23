# 0003 Workflow agents may run in the background

- Status: accepted, 2026-10-21 (dry run of P3)

## Context

The plan assumed that an Agent call with `run_in_background: false` runs in the foreground. In the interactive CLI 2.1.306 and in the Desktop app the Agent tool has no `run_in_background` parameter: every subagent runs in the background, and a value the model passes anyway does not reach the PreToolUse hook (observed in the session's tool schema and the hook input). A guard that required `false` therefore refused every workflow agent.

## Decision

The guard does not check `run_in_background`. Where the Agent tool has the parameter, `cw` still prints `false`. Where it has none, the orchestrator records the agent id, tells the user that the agent works, and runs nothing for the task until the report arrives as a message (ticket skill, ground rule 10).

## Consequences

- The orchestrator reads reports and reviews only with `cw report show` and `cw review show`, as before.
- The dry run checks the waiting, not a foreground run.
