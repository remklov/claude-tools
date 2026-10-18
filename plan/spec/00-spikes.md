# Spec 00 — Phase 0 spikes

Phase 0 verifies the platform assumptions the design rests on before any production code is written. Every spike has a fixed procedure, a pass criterion and a plan B that keeps the design workable if it fails. Results go into `plan/spikes-results.md` (one section per spike: date, Claude Code version, commands, observed output, verdict, consequence).

Tested baseline: Claude Code 2.1.302 on Linux (this host). Spikes marked **manual** need a person in an interactive session or the Desktop app.

## Harness

```text
spikes/                      # in the claude-tools repo, never listed in marketplace.json
├── make-fixture.sh          # creates a throwaway git repo under $TMPDIR/dw-fixture
├── spike-plugin/
│   ├── .claude-plugin/plugin.json      # name: "spike"
│   ├── agents/probe.md                 # plain probe agent
│   ├── agents/probe-wt.md              # same with isolation: worktree
│   ├── skills/pb-test/SKILL.md         # user-invocable: false, contains PB-TOKEN-7731
│   ├── bin/spike-echo                  # prints SPIKE-BIN-OK
│   └── hooks/{hooks.json,start.mjs,stop.mjs,guard.mjs}   # log stdin to $TMPDIR/dw-spike.log
└── spike-mod/               # minimal mod for S6
```

`make-fixture.sh`: `git init`, a `package.json` with a `test` script (`node --test`), one passing test, an initial commit, a second branch `feature-x` with one extra commit, and a `node_modules/` directory with a marker file (for symlink checks).

Each non-manual spike runs headless from the fixture:

```bash
claude -p "<prompt>" --plugin-dir ~/projects/claude-tools/spikes/spike-plugin --output-format json
```

## Spikes

| # | Assumption | Procedure | Pass | Plan B |
|---|---|---|---|---|
| S1 | Agent frontmatter `skills:` preloads a plugin skill into a plugin agent | `probe.md` has `skills: [spike:pb-test]`. Prompt: "Use the spike:probe agent. It must print the token from its preloaded skill without reading any file." Repeat with `skills: [pb-test]` | Token returned; record which name form works | Generator inlines the playbook's SKILL.md into each agent body; step files stay on-demand |
| S2 | Plugin `bin/` is on the Bash PATH of subagents, also in worktrees | Probe and probe-wt run `command -v spike-echo && spike-echo`. **Manual:** same prompt once in the Desktop app's Code tab | `SPIKE-BIN-OK` in all three | Skills and agents call `node "${CLAUDE_PLUGIN_ROOT}/scripts/cw.mjs"` (substituted in Markdown); permission rule `Bash(node *dev-workflow*/scripts/cw.mjs *)` |
| S3 | `SubagentStart` `additionalContext` reaches plugin subagents; 10,000-character cap | `start.mjs` returns a marker plus 12,000 filler characters; probe repeats the marker and the last 20 characters it sees | Marker seen; record truncation behaviour | Context map is written into the brief file instead; the hook only points to it |
| S4 | `SubagentStop` with `decision: "block"` keeps a plugin subagent running; `last_assistant_message` and `stop_hook_active` are present | `stop.mjs` blocks once if the last message lacks `VALID`, with reason "Answer with VALID". Probe is asked to answer "hello" | Second turn ends with `VALID`; second hook call has `stop_hook_active: true`; no loop | Orchestrator validates with `cw report validate` and returns invalid reports via SendMessage |
| S5 | `PreToolUse` input carries `agent_type`, `agent_id` and `cwd` for subagent Bash calls; deny reason reaches the agent | `guard.mjs` logs stdin and denies commands containing `forbidden`. Probe runs `echo hi`, then `echo forbidden` | Log shows `agent_type: "spike:probe"` and `cwd`; probe reports the deny reason | Guard identifies workflow subagents by `cwd` inside a task worktree (from state) |
| S6 | A mod can read `<git-common-dir>/dev-workflow/state.json` with `$.fs.read` and run `git rev-parse` with `$.process.run`; `claude plugin validate` accepts it | `spike-mod` reads the file every second (`$.fs.stat` mtime) and draws its `title` in the band. **Manual:** edit the file, watch the band in terminal and Desktop | Band follows the file within ~1 s | Keep the `progress` tool in the mod; the orchestrator playbook calls it after each `cw task` transition with the JSON `cw` prints |
| S7 | `isolation: worktree` on a plugin agent honours `worktree.baseRef: "head"` and `worktree.symlinkDirectories` | Fixture on `feature-x`, settings with `baseRef: head` and `symlinkDirectories: ["node_modules"]`. probe-wt prints `git log -1 --format=%H`, `ls -la node_modules` | HEAD equals the fixture's `feature-x` tip; `node_modules` is a symlink | `cw ws create` creates the worktree itself (`git worktree add`), symlinks, and the agent is told its path |
| S8 | **Manual.** A plugin implementer can edit files in its worktree without per-edit prompts, although plugin agents ignore `permissionMode` | Interactive session in default mode; probe-wt edits a file. Repeat with project `permissions.allow: ["Edit", "Write"]`, then with session mode `acceptEdits` | Record the least-privileged setting that avoids prompts | Document the required session mode in `cw init` output and README |
| S9 | `permissions.deny: ["Agent(model:*)", "Agent(effort:*)"]` blocks overrides when the orchestrator runs as a skill in the main session | Prompt asks to start `spike:probe` with `model: "haiku"` | Call denied | Guard hook on the `Agent` tool (`PreToolUse` matcher `Agent`) denies `model`/`effort` in `tool_input` |
| S10 | A Bash command from a worktree-isolated subagent can write to `<git-common-dir>/dev-workflow/` (also with `sandbox.enabled: true`) | probe-wt runs `node -e` that writes a file there; repeat with sandbox enabled in fixture settings | File written in both modes | Implementer-side `cw` writes to `<worktree>/.git-dw/` (excluded via `.git/info/exclude`); orchestrator-side `cw task sync` imports it |
| S11 | `claude plugin validate --strict` and `claude plugin test` run in CI without login | GitHub Actions job (or `docker run node:22`) installs Claude Code and runs both on the spike plugin | Both run, exit codes meaningful | CI runs only `node --test`; validation runs in a local `tools/prepush.sh` hook |
| S12 | The remote accepts custom refs and `--force-with-lease=<ref>:` gives create-if-absent semantics; `ls-remote`/`fetch` of `refs/claims/*` works | Against a private throwaway GitHub repo `remklov/dw-claims-spike` (created and deleted in the spike, with the owner's OK): two shells race `git push --force-with-lease=refs/claims/T-1: origin <sha>:refs/claims/T-1`; update and delete with leases; `git fetch --prune origin '+refs/claims/*:refs/dw/claims/*'`; timing of each call. Repeat against a local bare repo (backend tests) | Exactly one creator wins; stale leases fail; calls < 2 s | B1: create/delete refs through the REST API (`gh api repos/<o>/<r>/git/refs` returns 422 when the ref exists). B2: namespace `refs/heads/claims/<ID>` (branches; no CI noise in fisko, whose workflows run only on `main` pushes and pull requests) |
| S13 | `UserPromptSubmit` input carries `agent_type = "dev-workflow:orchestrator"` in a session started with `claude --agent dev-workflow:orchestrator` | Hook logs stdin; start the session with `--agent`, send one prompt | Field present with that value | The hook checks for the orchestrator marker file that `cw intake` and the playbook write per session instead |

## Exit criteria for Phase 0

- `plan/spikes-results.md` has a verdict for S1–S13.
- Every failed spike has its plan B written into the affected spec (01–07) before Phase 2 starts.
- ADRs in `docs/adr/` reflect the final mechanisms (WP-03).
