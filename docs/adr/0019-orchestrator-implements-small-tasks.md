# 0019 The orchestrator implements small tasks itself

- Status: accepted, 2026-11-01 (fisko, 21 tasks of 2026-10-19 to 2026-11-01)

## Context

A comparison with a single-session workflow found that, for small tickets, separate contexts cost about twice the tokens and more time without adding value. Observation reported by a colleague; their tasks are not in these sources.

[ADR 0014](0014-fewer-orchestrator-calls.md) rejected an orchestrator that implements below `xl` (2.6–3.4 times the implementer's input). That figure kept our orchestrator as it was: its whole context at the spawn (94–295k), the earlier tasks of its session, and every `cw` step. A fresh session per ticket with no orchestrator is a different comparison.

Replayed from the transcripts of 21 fisko tasks:

- **The single session:** a fresh session (70k of base context) does the intake without the workflow's own steps, then the implementer's and the reviewer's work in time order. Every call carries everything before it, plus a few delivery calls.
- **Priced** with the published prices: Opus 5.5 $4 per MTok of input, cache hits 0.05×, cache writes 1.25× (5 minutes), output 5×; Sonnet 5.5 at half. The s and m implementers run on Sonnet.

| Complexity | Tasks | The workflow against one fresh session | Peak context of the session |
|---|---|---|---|
| s | 1 | 1.60× | 118k |
| m | 4 | 0.95× (0.79–1.01) | 142–252k |
| l | 5 | 0.87× | 270–650k |
| xl | 11 | 0.94× | 290k–1M |

Only `s` costs clearly more in the workflow. In `m` the Sonnet implementer evens it out. Above that, the session would pass the 206–252k at which three orchestrator sessions were compacted in the Desktop app.

A session that implements and keeps the reviewer as an agent costs, against the workflow: 1/1.54 in `s` and 1/0.98 in `m`.

## Decision

- **`workflow.selfImplement`** (default `["s"]`) lists the complexities the orchestrator implements itself.
  - `cw task start` then prints no Agent call; it marks the task `self` and points to `steps/o6-self.md`. `--agent` delegates anyway.
  - `cw task start --new-agent` and `cw task return --new-agent` hand the work to an implementer agent, for a task that turns out bigger or a context that grows large.
- **The work tree.**
  - In place, `cw ws setup` works as for an agent.
  - In worktree mode `cw ws setup` adds `.claude/worktrees/self-<id>` from the main checkout, on a new task branch at the base or on the kept branch. It links the `node_modules` of the root and of every package, as Claude Code's `worktree.symlinkDirectories` does for agents. `cw task cleanup` removes it as an agent's worktree.
- **Guards.** While such a task is in `implement`, G-ORCH-EDIT lets the owning session edit inside the task's work tree, and its Bash calls get the implementer's guards (G-PUSH, G-DEPS, G-COMMANDS, G-PORTS, G-DEVSERVER). Every other project file stays closed.
- **No git of its own.**
  - `cw commit msg --commit` stages every change of the work tree except `node_modules` links (an untracked symlink, which a `node_modules/` ignore pattern misses) and commits with the message file.
  - `cw test --task <id> --test <package>:<file>` runs one test in the work tree with the package's single-test command, also for agents, which no longer need a subshell.
- **Review.** The reviewer stays an agent. `cw task return` prints the findings for the orchestrator to fix itself.

## Evidence

- **Sources.** The Claude Code transcripts of the orchestrator sessions and their agents, and the task files of fisko.
- **Prices.** platform.claude.com/docs/en/about-claude/pricing, read 2026-11-01.
- **Observation, Desktop app (Claude Code 2.1.309).** Orchestrator sessions in fisko added worktrees next to the main checkout with `git worktree add` without a refusal. The sandbox refused writes under `.git/worktrees` only in the P3 dry run (PLAN Appendix A).

## Consequences

- An `s` task saves the implementer's context and its start. The orchestrator's context grows by the implementation, which the next task avoids in a new session (ADR 0014).
- A project that wants every task delegated sets `workflow.selfImplement` to `[]`. One that also wants `m` adds it; in fisko that is about even in cost and saves the agent's start.
- The orchestrator implements at the session's model and effort, not at the tier's. For `s` the tier was Sonnet at low effort.
