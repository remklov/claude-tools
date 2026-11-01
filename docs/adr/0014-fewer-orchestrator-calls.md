# 0014 Fewer and smaller orchestrator calls

- Status: accepted, 2026-11-01 (fisko, 15 tasks of 2026-10-25 to 2026-11-01)

## Context

The orchestrator cost the most per call. In 13 orchestrator sessions it read 173 M tokens from the cache, at 140–350k tokens of context per call during a task. With small tasks it caused 57–72 % of a task's cost. Much of that came from calls that move nothing forward:

- **`cw task agent`, 45 calls, 9.3 M.** The orchestrator recorded every agent id by hand, although the SubagentStart hook recorded all 69 agent starts of the week; `hooks.log` names no start it left out.
- **The read before a review.** After each implementer round the orchestrator ran `cw report show`, `cw git foreign-commits` and `cw task review`, in up to three calls.
- **The agents' final messages.** Every agent ended with the whole JSON fence of its saved report or review. 48 task notifications carried 196k tokens into the orchestrator's context, 6.4 M cache reads in its later calls. `cw report show` and `cw review show` then printed the same content again. For the agents these were output tokens.
- **The PR/MR body.** The orchestrator rewrote 11 of 17 generated bodies completely, with a Write and `cw pr body --stdin`. The generated text listed every requirement, every proof with its failure line, and findings carried over from an earlier round twice.
- **Several tasks in one session.** Two tasks started at 197k and 202k tokens, because their session still held the previous task: 7.1 M. Work after a session's last task, such as questions, housekeeping and other topics, took 206 calls and 43.8 M, at the size of the whole task.

A rejected alternative was that the orchestrator implements tasks below `xl` itself. Recalculated over the 14 runs below `xl` with the same orchestrator, it cost 2.6–3.4 times the implementer's input. That held after subtracting the coordination calls it saves, the reads of files it already knew and the implementer's `cw` steps, and adding the work it carries afterwards. Its context at the spawn was 94–295k, the implementer's 18–19k.

## Decision

- **No agent is recorded by hand.** O6 and O8 drop `cw task agent`, and no `Next:` names it. `cw report show`, `cw task review` and `cw review show` warn and name the command only when no agent of the role is recorded. The hook records none while several tasks of the session wait for the same role.
- **One call after an implementer round.** In `implement`, `cw task review` does three things: it prints the done report, refuses foreign commits or a work tree off the task branch with the fix for the implementer (exit 1), and starts the review round. For any other status it names `cw report show`. Every `Next:` after an implementer is `cw task review`.
- **Agents end with one line.**
  - `cw report save` and `cw review save` print a summary and the line `dev-workflow report <id> round <n>: <status>` (or `review … round <n>.<r>`), and the agent ends with that line.
  - The SubagentStop gate reads its status as it read the JSON status before; a JSON fence of an earlier playbook still counts.
- **The PR/MR body around the orchestrator's summary.**
  - `cw pr body --what <file>` takes three to six lines the orchestrator writes for What & why; without it, at most six requirements are listed.
  - Testing names the passing checks in one line per package. One proof keeps its failure line; several proofs are named by their test files.
  - Open points come from the final review only (ADR 0015).
- **A new session per ticket.** `cw task list` notes when the session ran a task before, and O1 suggests a new session to the user. `cw task end` says that the next ticket or other work is cheaper in a new session.

## Evidence

- **Sources.** The Claude Code transcripts of the orchestrator sessions and their agents, the task files and `hooks.log` of fisko, 2026-10-25 to 2026-11-01.
- **Cost measure.** Cache reads per API call as in [ADR 0012](0012-fresh-implementer-above-context.md). A content's cost is its size times the calls that carry it until a compaction.
- **Observation, Desktop app (Claude Code 2.1.309).**
  - The SubagentStart hook fires again when an agent is continued with SendMessage: it logged reviewer `ace16478285489f51` for round 1 and round 2 of one task.
  - The task notification of a background agent carries the agent's final message.

## Consequences

- The happy path of a round needs four orchestrator calls fewer:
  - `cw task agent` after each spawn;
  - the separate report read and foreign-commit check;
  - the PR/MR rewrite.
- An agent of an earlier playbook that still ends with the JSON fence passes the stop gate. Its fence costs what it cost before.
- The base context of the orchestrator stays: 72k tokens in fisko, carried by every call (61 M of the 173 M). Most of it is outside the plugin: the skill and agent listings of other plugins and a SessionStart hook of the user. Trimming those is the project's choice.
