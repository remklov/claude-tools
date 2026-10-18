# Phase 0 spike results

Date: 2026-10-18 · Claude Code 2.1.302 · Linux · harness `spikes/` (fixture created by `spikes/make-fixture.sh`), headless runs with `claude -p --plugin-dir spikes/spike-plugin`.

| # | Verdict | Evidence | Consequence |
|---|---|---|---|
| S1 | ✅ pass | `skills: [spike:pb-test]` in a plugin agent: the probe printed `PB-TOKEN-7731` without reading files | Agents preload `dev-workflow:<role>-playbook` (plugin-scoped name form) |
| S2 | ✅ pass (CLI) · ⏳ Desktop manual | `command -v spike-echo` resolved to the plugin's `bin/`, also in a worktree-isolated agent | `bin/cw` is the entry point; Desktop check is part of WP-63 |
| S3 | ✅ pass | Marker arrived; a 12,000-character context was saved to a file and only a preview was injected | Keep the SubagentStart context ≤ 6,000 characters (spec 06) |
| S4 | ✅ pass | First stop blocked with `decision: "block"`; the agent continued; second call had `stop_hook_active: true`. **The agent's new final message replaces the earlier one** | The block reason must ask for the complete JSON again (spec 06 §5 updated) |
| S5 | ✅ pass | Subagent Bash calls carry `agent_type: "spike:probe"`, `agent_id`, `cwd`; the agent saw `PreToolUse:Bash hook error: SPIKE-GUARD: forbidden word` | Guard as specified |
| S6 | ⏳ in WP-61 | Tested together with the mod (`claude plugin test` + manual band check) | Plan B (progress tool) stays documented |
| S7 | ✅ pass | Worktree agent on fixture branch `feature-x`: `HEAD` = `feature-x` tip (`baseRef: head` honoured), `node_modules` symlinked | Use Claude Code's worktree isolation |
| S8 | ⏳ manual | Not testable headless; sessions on this host run in bypass mode | Interactive check during the fisko pilot; `cw doctor` prints the recommendation |
| S9 | ✅ pass | `Agent` with `model: "haiku"` → "Permission to use Agent with model:* has been denied." | Deny rules suffice; guard G-AGENT-OVERRIDE stays as a backstop |
| S10 | ✅ pass with condition | From a worktree-isolated agent, a **plain executable** (`spike-write`, which runs `git rev-parse` internally) wrote to `<git-common-dir>/dev-workflow/`. An inline `node -e "…execSync('git …')…"` was **refused**: "this command names git in a form too complex to verify that it stays inside the worktree" | All git work of implementers goes through `cw …` or plain `git …` in the worktree; playbooks forbid inline scripts that call git (spec 05, 06 updated) |
| S11 | ⏳ in WP-11 | CI run | Fallback `tools/prepush.sh` |
| S12 | ✅ pass | `refs/claims/*` on the private GitHub repo: 3 races of two parallel pushes with `--force-with-lease=<ref>:` → exactly one winner each (exit 0 vs 1); stale-lease update rejected; fetch to `refs/dw/claims/*` and `cat-file` work; ~1.7 s per push. Pitfall: pushing the **same** sha again reports "Everything up-to-date" (exit 0) | Claims via git refs; `cw` verifies ownership with `ls-remote` after every push and always creates unique payload commits |
| S13 | ✅ pass | `UserPromptSubmit` input of a `claude --agent spike:probe` session carries `agent_type: "spike:probe"` | `ticket-intent` hook as specified |

Additional finding: Bash commands get `CLAUDE_CODE_SESSION_ID` in their environment → `cw` uses it as the claim holder's session id (spec 02 §4.7).
