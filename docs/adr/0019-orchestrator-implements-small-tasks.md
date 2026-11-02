# 0019 The orchestrator implements small tasks itself

- Status: withdrawn, 2026-11-02. Released in dev-workflow 0.8.0, removed again in the next release.

## What was decided

From dev-workflow 0.8.0 the orchestrator implemented the complexities of `workflow.selfImplement` (default `["s"]`) itself, and the reviewer stayed an agent:

- In worktree mode `cw ws setup` added `.claude/worktrees/self-<id>`.
- G-ORCH-EDIT opened that work tree to the owning session.
- `cw commit msg --commit` committed for it.

The reason given was a replay of 21 fisko tasks. It found that our workflow cost 1.6 times one fresh session for an `s` task.

## Why it is withdrawn

That replay modelled a session **without an orchestrator**. Its saving came from the orchestrator's own work: the intake with the workflow's steps, the step files, the `cw` outputs and the coordination calls. The self-implementation kept all of that. It removed only the implementer agent, which was the cheap part:

- the implementer of an `s` or `m` task runs on Sonnet 5.5, at half the price of Opus 5.5;
- each of its calls reads 18k of context instead of the orchestrator's.

Repriced for what was built: the orchestrator's calls as they ran, without the ones that only coordinated the implementer; the implementer's calls on Opus in the orchestrator's context; the orchestrator's later calls carrying that work; the reviewer unchanged. Each task is counted in a fresh session.

| Task | Complexity | Delegated | Self-implemented |
|---|---|---|---|
| OPS-24 | s | $2.34 | $2.53 (+8 %) |
| APP-17 | m | $1.92 | $2.34 (+22 %) |
| chore of DGII-14 | m | $1.77 | $2.55 (+44 %) |
| DGII-15 | m | $4.74 | $6.38 (+35 %) |
| SEC-13 follow-ups | m | $2.38 | $3.14 (+32 %) |

In the `s` task the orchestrator caused $1.87 of the $2.34 (80 %), the implementer $0.17 and the reviewer $0.30. A task gets cheaper where the orchestrator gets cheaper ([ADR 0014](0014-fewer-orchestrator-calls.md)), not by moving the implementation into it.

## What stays

`cw test --task <id> --test <package>:<file>` runs one test in the task's work tree. The implementer playbook uses it instead of a subshell `cd` into the package, which worktree-isolated agents could not always run: about a dozen refusals in the fisko week of 2026-10-25.

## Evidence

- **Sources.** The Claude Code transcripts and task files of fisko, 2026-10-19 to 2026-11-01.
- **Prices.** platform.claude.com/docs/en/about-claude/pricing, read 2026-11-01: Opus 5.5 $4 per MTok of input, Sonnet 5.5 $2; cache hits 0.05×, cache writes (5 minutes) 1.25×, output 5× of the input price.
