# 0020 The spec phase runs at high effort, the rest at the session's

- Status: accepted, 2026-11-02 (owner decision)

## Context

The orchestrator is the senior technical consultant of a task:

- it checks the ticket and the code;
- it asks until every requirement and acceptance criterion holds;
- it writes the spec the implementer and the reviewer work from.

That work needs a high effort. The plugin set the effort of every agent (`tools/generate-agents.mjs`, `agents/reviewer.md`) but not the orchestrator's: the ticket skill ran at whatever effort its session had. In fisko that was `high` in the week of 2026-10-25, and `max`, `xhigh` and `medium` in earlier sessions. A session started at `medium` wrote the spec at `medium`.

The orchestrator's later work is mostly mechanical: reading the report, starting the review, recording decisions, delivering. At `high` it cost $1.49 of output on the five small fisko tasks, and its reasoning stays in the context of every later call.

## Decision

- **The ticket skill sets `effort: high`.** Claude Code applies a skill's `effort` "for the rest of the current turn" and lets it override the session effort level, but not the `CLAUDE_CODE_EFFORT_LEVEL` environment variable. With the next prompt the session's effort resumes.
- **The spec phase is that turn.**
  - O1 to O6 run in the turn `/dev-workflow:ticket` starts.
  - Ground rule 10 keeps it one turn: questions go only through AskUserQuestion, whose answer continues the turn, never as text that ends it.
  - The turn ends when the orchestrator waits for the background implementer.
- **Every later turn runs at the session's effort:** the wake-ups after an agent, the user's answers after a review, the delivery. A session at `medium` keeps the consultant's work at `high` and the rest at `medium`.

## Evidence

- **Claude Code documentation:** code.claude.com/docs/en/skills, "Supported frontmatter fields", read 2026-11-02 (`effort`: "Effort level for the rest of the current turn. Overrides the session effort level, but not the `CLAUDE_CODE_EFFORT_LEVEL` environment variable").
- **fisko transcripts, 21 tasks of 2026-10-19 to 2026-11-01.**
  - In 19 of them, nothing ended the turn between the ticket command and the implementer's Agent call: no message of the user and no `end_turn`.
  - The two others were interrupted by the user: a pause in OPS-24, "Weiter" in SEC-23.
  - The agents' effort per role comes from the same transcripts (`output_config.effort`).
- **Observation, Desktop app 2.1.309 and the interactive CLI 2.1.306** (PLAN Appendix A): the Agent tool has no `run_in_background` there, so the implementer runs in the background and the orchestrator's turn ends after the delegation.

## Consequences

- The spec phase no longer depends on the effort the user started the session with.
- Where the Agent tool has `run_in_background` and the orchestrator passes `false` (headless runs), the implementer returns within the same turn. The orchestrator's work then stays at `high` until that turn ends.
- A message the user sends during the spec phase ends the high-effort turn early. The rest of that spec phase runs at the session's effort.
- Whether `medium` for the later turns is enough is to be measured on the next fisko tasks: review rounds, decisions and delivery calls.
