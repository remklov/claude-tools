# Spec 06 — Hooks of `dev-workflow`

All hooks are Node scripts in `plugins/dev-workflow/hooks/`, registered in `hooks/hooks.json` in exec form (`"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/<file>.mjs"]`). They import `../scripts/lib/*` directly (no `cw` subprocess, to stay fast).

## 1. Common behaviour

- Read stdin JSON; find the repo with `git -C <cwd> rev-parse --show-toplevel`. No git repo or no `.claude/workflow/profile.json` → exit 0 with no output (**no-op**). This makes the plugin safe to enable everywhere.
- Never fail the session: every hook wraps its body in try/catch; on error it appends to `<common-dir>/dev-workflow/hooks.log` (timestamp, hook, message, stack) and exits 0 with no output. Exception: the guard and stop hooks fail **open** (exit 0) on internal errors and say so in the log.
- Time budget: < 1 s typical, hard stop at 5 s (`setTimeout(() => process.exit(0), 5000)`); `doctor` results come from the cache.
- Output only facts, no imperative system-style text (prompt-injection defenses).

```json
{
  "hooks": {
    "SessionStart": [{ "matcher": "startup|resume", "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"] }] }],
    "SubagentStart": [{ "matcher": "^dev-workflow:", "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/subagent-start.mjs"] }] }],
    "SubagentStop": [{ "matcher": "^dev-workflow:(implementer-(s|m|l|xl)|reviewer|investigator)$", "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/subagent-stop.mjs"] }] }],
    "PreToolUse": [{ "matcher": "Bash|Agent", "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"] }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/ticket-intent.mjs"] }] }]
  }
}
```

## 2. `session-start.mjs`

1. Run doctor checks from cache (refresh if older than 12 h or keys changed), plus `rules build --check` (cheap: hashes only).
2. All pass → no output.
3. Otherwise output:

```json
{
  "systemMessage": "dev-workflow: 2 setup issues (rulebook out of date; gh not logged in). Details are in the session context.",
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "dev-workflow setup facts:\n- The compiled rulebook is out of date: plugin 1.1.0 changed TS-NO-CAST and added VITEST-TIMERS. `cw rules build` regenerates it.\n- `gh auth status` reports no login for github.com. The orchestrator needs it to open pull requests; the user runs `gh auth login` in their own terminal.\n- Mention these once before starting on the user's first request; do not change settings files yourself."
  }
}
```

4. On `resume`, only report items that changed since the last report (stored in the cache).

## 3. `subagent-start.mjs`

Input: `agent_type` (e.g. `dev-workflow:implementer-m`), `agent_id`, `cwd`.

1. Role from `agent_type` (`implementer-*` → implementer).
2. Build the context of spec 01 §13: packages with checks (implementer, reviewer), procedures for the role (all active ones with `when` and absolute path), guards, scripts hint. ≤ 6,000 characters; if longer, drop procedure descriptions first, then packages without checks.
3. Output `hookSpecificOutput.additionalContext` (`hookEventName: "SubagentStart"`).

Task-specific information is deliberately **not** injected (the input carries no task reference); it comes from the brief file named in the prompt.

## 4. `guard.mjs`

Input: `tool_name`, `tool_input`, `agent_type` (absent for the main conversation), `agent_id`, `cwd`.

### 4.1 Command parsing (Bash)

Split `tool_input.command` into segments on unquoted `&&`, `||`, `;`, `|`, newlines and `$( … )`/backtick boundaries; tokenize each segment shell-like (single/double quotes, escapes); strip leading env assignments (`FOO=bar cmd`) and `sudo`/`env`/`command`/`exec`/`nohup`/`timeout <n>` wrappers. Unparseable input → check the raw string with the regex-based rules only.

### 4.2 Catalog

Applies to: **W** = workflow subagents (`agent_type` starts with `dev-workflow:` except the orchestrator agent), **R** = reviewer and investigator only, **A** = everyone incl. the main session.

| ID | Applies | Match | Decision and reason (shown to the agent) |
|---|---|---|---|
| G-PUSH | W | `git push`, `gh pr create`, `gh pr merge`, `glab mr create`, `glab mr merge` | deny — "Only the orchestrator pushes and opens pull requests, after the user confirms." |
| G-FORCE | A | `git push` with `--force`, `-f`, `--force-with-lease` | deny — "Force pushes are not part of the workflow. Ask the user." |
| G-MAIN-CHECKOUT | W | in worktree mode: `cd <protected>`, `git -C <protected> …`, `pushd <protected>`, or any absolute path argument under `<protected>` that is not under the agent's worktree (`<protected>` = `isolation.protectedCheckout`, `~` expanded) | deny — "The main checkout runs the owner's dev stack. Work only inside your worktree <cwd>." |
| G-GIT-WRITE-R | R | `git commit`, `add`, `checkout`, `switch`, `reset`, `rebase`, `stash`, `merge`, `cherry-pick`, `restore`, `clean`, `branch -d/-D/-m`, `worktree add/remove` | deny — "Reviewers and investigators don't change the repository. Use `cw mutate` for mutation checks." |
| G-FILE-WRITE-R | R | `sed -i`, `perl -i`, `tee`, `>`/`>>` redirection to a path inside the repository, `rm`, `mv`, `cp` into the repository | deny — same reason |
| G-DEPS | W | pack + profile dependency commands (`npm install` …) | deny — "Dependency changes need the owner. Stop and report `blocked` with the package and version you need." |
| G-COMMANDS | W | `guards.commands` (token-prefix or `/regex/`) incl. pack contributions | deny — "<command> is not allowed in this project (guards in .claude/workflow/profile.json)." |
| G-PORTS | W | a guarded port as `:<port>` in a URL/host, `--port <port>`, `--port=<port>`, `-p <port>`, `PORT=<port>` | deny — "Port <port> belongs to the owner's environment (guards.ports)." |
| G-DEVSERVER | W | `guards.devServer = never` and segment runs `npm run dev`, `vite`, `next dev`, `npm start` | deny — "No dev servers in this project. Verify with tests and list browser checks as manual open points." |
| G-WRITE-PATHS | W | redirection or `cp`/`mv`/`tee` to a path matching `guards.writePaths` | deny — "<path> is protected (guards.writePaths)." |
| G-AGENT-OVERRIDE | A | `tool_name = Agent` and `tool_input` has `model` or `effort` | deny — "Model and effort are fixed per agent; call the agent without them." (Backstop for spike S9) |
| G-NO-FABLE | A | `tool_name = Agent` and `subagent_type` resolves to an agent whose model contains `fable` (project-local agents only) | deny — "Fable models are not used in this setup." |

Output on deny:

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny",
  "permissionDecisionReason": "G-PORTS: Port 5174 belongs to the owner's environment (guards.ports)." } }
```

No match → exit 0 with no output (normal permission flow continues). The guard never returns `allow`.

### 4.3 Tests

One test per catalog entry for a positive and a negative case, plus parser cases: quotes (`echo "git push"` is not a push), env prefixes, `&&` chains, `$(…)`, heredocs (body ignored), and the main-session exemption.

## 5. `subagent-stop.mjs`

Input: `agent_type`, `agent_id`, `last_assistant_message`, `stop_hook_active`, `cwd`.

1. Expected kind by role: implementer → `dev-report`, reviewer → `review`, investigator → `investigation`.
2. Extract the last fenced ```json block from `last_assistant_message`; parse; validate against the schema; check that the saved file exists for that task and round and is byte-identical in content (re-serialized compare).
3. Valid → exit 0, no output.
4. Invalid and fewer than 2 previous blocks for this `agent_id` (counter in `task.json.stopAttempts`, or in `hooks-state.json` when no task resolves) → output

```json
{ "decision": "block", "reason": "Your final message must be the complete JSON that `cw report save` prints — it replaces your previous final message, so repeat it in full. Problem: AC3 has no evidence. Run `cw report save --task <id>` again with the missing fields and end with its full output." }
```

5. Invalid after 2 blocks, or `stop_hook_active` already true twice → exit 0 and log; the orchestrator's `cw task review` precondition still refuses an invalid report, so nothing slips through.

## 6. `ticket-intent.mjs` (UserPromptSubmit)

Purpose: in an orchestrator session, "starte mit Ticket XYZ" must reliably start O1 with the claim.

1. Active only when the session runs as the orchestrator (`agent_type` = `dev-workflow:orchestrator`) or a dev-workflow task of this checkout is in phase `intake`…`deliver` and was started from this session (session file of spec 02 §4.7). Otherwise no-op.
2. Match the prompt (case-insensitive, German and English):
   - Start verbs: `start(e)?`, `beginne`, `nimm`, `arbeite an`, `übernimm`, `mach`, `work on`, `pick( up)?`, `take`, `do` — followed within 6 words by a ticket ID matching `tickets.idPattern` (several IDs → all listed, the orchestrator handles them one after another).
   - Next ticket: `(das )?nächste(s)? ticket`, `next ticket`, `nächste aufgabe`.
   - No start verb but an ID (e.g. "was steht in NV-9?") → no output.
3. Output `hookSpecificOutput.additionalContext` (`hookEventName: "UserPromptSubmit"`), factual: `Ticket request detected: NV-9. Workflow step O1 applies; its first command is \`cw intake NV-9\`.` (or `cw intake --next`).
4. The hook never claims by itself: the claim is the orchestrator's first tool call, so a misread sentence can still be corrected by the user before anything happens on the remote. Latency budget: 200 ms (regex only, no git).

Tests: 20 German and English phrasings (positive and negative), ID patterns of markdown-table and github-issues, inactive outside orchestrator sessions.

## 7. What the hooks do not do

- They never write project files, settings or the rulebook.
- They never start services or run checks.
- They don't inspect the main session's Edit/Write calls; the orchestrator's "no code edits" rule is enforced by the agent's `disallowedTools` in agent mode and by instructions in skill mode (accepted risk, listed in PLAN.md under risks).
