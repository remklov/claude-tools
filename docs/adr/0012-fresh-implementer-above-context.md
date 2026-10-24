# 0012 A fresh implementer above 150k tokens of context

- Status: accepted, 2026-10-24 (an XL task in fisko)

## Context

`cw task return` sent the review findings to the same implementer by SendMessage (D4). In fisko an XL task's implementer made 168 API calls while its context grew from 18k to 492k tokens (294k on average): 48.5 M cache reads, about 70 % of the task's cost. The fixes of review round 1 reached it at about 450k; its 18 calls for small, local fixes cost about 8 M cache reads on their own. A fresh implementer with the spec, the report, the branch state and the findings would have started at 50–80k, and at that size a model also keeps better track of what matters. What the old agent still "knows" is worth little by then.

## Decision

- **Rule.** When `cw task return` sends work back (findings, a spec change, the go-on after an escalation), it measures the recorded implementer's context. Above `workflow.freshImplementerAboveTokens` (default 150000; `0` or `null` switch the rule off) it prints a fresh Agent call instead of the SendMessage, the same as `--new-agent`. It is one more reason next to an agent of an earlier session and a lost worktree; the orchestrator does not decide, it runs what `cw` prints.
- **Measure.** The size is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` of the last assistant message in the agent's transcript (synthetic messages, such as API errors, carry no usage and are skipped). `cw` reads the file backwards from its end, so a transcript of several MB costs milliseconds.
- **Find the transcript.** SubagentStop records `agent_transcript_path` from its input in `agents.<role>.transcript`. That is the path Claude Code reports itself, so it holds wherever the files live. Without it, `cw` looks for `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/*/<session>/subagents/agent-<id>.jsonl`, with the session recorded by `cw task agent` or SubagentStart. It tries every project folder rather than derive the folder name from a path, because `CLAUDE_CODE_PROJECT_DIR_NAME` can replace that name. A recorded path counts only when its file name is this agent's.
- **Unknown size.** When no transcript is found or it cannot be read, the SendMessage stays and the output says so in one line. `cw` neither stops nor guesses.
- **Handover without an extra call.** Asking the old agent for a handover would cost one more call with its full context. Instead every report carries the required `handover` (`decisions`, `rejected`, `testing`, `pitfalls`, `deviations`; at most 8 notes of at most 400 characters each, and a done report fills at least one). `cw report save` refuses a report without it.
- **Takeover brief.** A fresh implementer of a started task (`cw task return` or `cw task start --new-agent`) gets the spec, the handover with the risks and open points of the newest report, the findings of the round, and the branch state: head, commit subjects (at most 20) and the changed files (at most 80). It gets no diff and no test output, so the brief stays small. The changed files also select the rules and procedures, because a new worktree agent has no work tree yet.
- **Traceability.** The task history records the switch (`a fresh implementer for round 2 (context 451k > 150k)`, with `agentSwitch: { role, previous, reason, tokens, limit }`), and `cw task show` prints it.

## Evidence

- Hooks page (code.claude.com/docs/en/hooks, read 2026-10-24): SubagentStop receives `agent_transcript_path`, "the subagent's own transcript stored in a nested `subagents/` folder"; the example is `~/.claude/projects/.../abc123/subagents/agent-def456.jsonl`.
- Env-vars page (code.claude.com/docs/en/env-vars, read 2026-10-24): `CLAUDE_CONFIG_DIR` overrides `~/.claude`, where session history is stored; `CLAUDE_CODE_PROJECT_DIR_NAME` chooses the `projects/` folder name.
- Observation, headless CLI 2.1.310 on Linux, a throwaway spike plugin that logged the hook inputs: SubagentStart carries `transcript_path` only; SubagentStop carries `agent_transcript_path` as `<config dir>/projects/<folder>/<session>/subagents/agent-<id>.jsonl`, for an agent with `isolation: "worktree"` too, under the parent session's folder.
- Observation, interactive CLI 2.1.309 on Linux (fisko, worktree mode): the XL implementer's transcript sat at that path with the session and agent id that `task.json` recorded; the measure gave 492427 tokens, the same as parsing the whole file.
- Not checked: the Desktop app. Its SubagentStop input matched the CLI's except for `last_assistant_message` (S7, Desktop 2.1.299), and its transcripts are under `~/.claude/projects/` (observation in [dry-run.md](../dry-run.md)); where neither holds, the size is unknown and the SendMessage stays.

## Consequences

- An agent from a version before this one has no recorded transcript path; the search under the config dir still finds it.
- A report written for an older playbook without `handover` is refused once, with the shape in the message; the implementer adds the field and saves again.
- Open: the same rule for the reviewer; splitting large tickets automatically; the model and effort of the agents stay as they are.
