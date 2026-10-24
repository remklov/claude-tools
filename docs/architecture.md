# Architecture

How the parts of the marketplace fit together, for whoever maintains them. The decisions and their reasons are in `docs/PLAN.md` (cited as D1 … D12 and §n) and the owner decisions of the build in [adr/](adr/README.md); the role playbooks step by step are in [playbooks.md](playbooks.md), the project config in [config.md](config.md), and how to change things in [extending.md](extending.md).

```text
user: /dev-workflow:ticket APP-42
        │
        ▼
main session = orchestrator ── skill ticket (O1–O10; step files through cw playbook read)
        │  cw task …, ticket context|save, spec …, classify, report show, review show, pr …
        │  Agent calls exactly as cw prints them
        ├────────▶ implementer-{s,m,l,xl}   skill implementer-playbook
        │            cw ws setup · context · rules applicable · checks · commit msg/lint · prove · report save
        └────────▶ reviewer (read-only)      skill reviewer-playbook
                     cw review scope · checks · prove --recheck · rules applicable · review save

every cw call ──▶ <git common dir>/dev-workflow/   state.json · tasks/<id>/… · hooks.log
                        ▲                                   ▲
   hooks: SessionStart, SubagentStart,             agents-progress mod
   SubagentStop, PreToolUse guard                  (pane and band, reads state.json)
```

## Two plugins, no dependency

| Plugin | What | Installed |
|---|---|---|
| `dev-workflow` | The `cw` CLI, the agents, the skills, the hooks, the packs, the `default` git preset, the schemas and the `cw init` templates | for the project (`setup.sh`, `--scope project`) |
| `agents-progress` | A display mod: an Agents pane and a task band above the prompt | per developer and project, only after a yes (`--scope local`, R9) |

`.claude-plugin/marketplace.json` lists both by relative path; each version lives only in its own `plugin.json`. They stay apart for three reasons:

- **No `dependencies` entry in either direction.** A dependency installs the other plugin automatically (D1), and neither plugin is ever installed without consent. The mod only reads a file `cw` writes, so it needs no code of `dev-workflow`, and `dev-workflow` works the same without the mod.
- **No root `settings.json` in either plugin.** Its `agent` key would make every session the orchestrator (D1, D2). A session is normal until the user runs the ticket command (R4).
- **Separate release and opt-in.** Each plugin has its own version, CHANGELOG section and tag. repo-lint (`tools/repo-lint.mjs`) refuses a `dependencies` key, a root `settings.json` and a `version` in `marketplace.json`.

## Roles

| Role | Runs as | Playbook | Model and effort |
|---|---|---|---|
| Orchestrator | the main session, from `cw task new` until `cw task end` | `skills/ticket/`: `SKILL.md` (ground rules, step table), `steps/o1-intake.md` … `o10-close.md`, `reference/{spec,jira,linear,local,recovery}.md` | the session's own |
| Implementer | `agents/implementer-{s,m,l,xl}.md`, one per complexity | `skills/implementer-playbook/`, preloaded through the agent's `skills:` field | s, m: `claude-sonnet-5-5` low, medium; l, xl: `claude-opus-5-5` medium, high |
| Reviewer | `agents/reviewer.md` | `skills/reviewer-playbook/`, preloaded | `claude-opus-5-5`, high |

- **Entry.** `ticket` sets `disable-model-invocation: true`: only `/dev-workflow:ticket <TICKET-KEY | NO-TICKET> [notes]` starts it (D2). The agent playbooks set `user-invocable: false` and never `disable-model-invocation`, which would stop the preload (D4, spike S1).
- **Step files.** The orchestrator reads a step or reference file when it enters the step, with `cw playbook read steps/<file>` or `cw playbook read reference/<file>`: the plugin lies outside the project, and the Read tool asks before files there (D3).
- **Generated implementers.** `tools/generate-agents.mjs` writes the four implementer files from one `MATRIX` and the guardrail texts of `cli/lib/guardrails.mjs`, which the briefs use too. `agents/reviewer.md` is hand-written; `--check` compares its model, effort and colour with the matrix and requires `disallowedTools: Edit, Agent`.
- **Tools.** Implementers: `Read, Edit, Write, Grep, Glob, Bash`, `disallowedTools: Agent`. Reviewer: `Read, Grep, Glob, Bash, Write`; it writes only its review file outside the project (guard G-REVIEWER-WRITE).
- **Per-call parameters.** No agent file sets `isolation`, `permissionMode`, `hooks`, `mcpServers` or `initialPrompt`. In worktree mode `cw task start` prints `isolation: "worktree"` for the Agent call (D4).
- **User skills.** `/dev-workflow:status` (`cw task list`, `cw task show`) and `/dev-workflow:doctor` (`cw doctor --fresh`).

## `cw`, the deterministic core

`bin/cw` is a Node shim on the Bash tool's PATH that imports `cli/cw.mjs` (D10). `cw.mjs` builds one registry from the modules in `cli/commands/`; each entry has a path (`task start`), a help group, usage, flags and a handler. The logic is in `cli/lib/`. Node ≥ 20, ESM, no npm dependencies, no build step. `cw` finds its own files through `import.meta.url` (`cli/lib/paths.mjs`), because `CLAUDE_PLUGIN_ROOT` does not reach Bash commands (D10).

| Group (`cw help`) | Commands |
|---|---|
| Setup and inspection | `version`, `config show\|validate`, `init`, `doctor`, `playbook show`, `rules build\|list\|show\|applicable` |
| Orchestrator | `playbook read`, `task new\|list\|show\|confirm\|agent\|start\|review\|return\|reset\|cleanup\|end`, `ticket context\|save`, `spec save\|show\|lint`, `classify`, `report show`, `review show`, `git foreign-commits`, `pr title\|body\|command\|record` |
| Implementer | `ws setup`, `context`, `checks`, `commit msg`, `commit lint`, `prove`, `report save`, `step`, `run` |
| Reviewer | `review scope`, `review save` (plus `checks`, `prove --recheck`, `rules applicable`, `commit lint` of the other groups) |

| Exit | Meaning |
|---|---|
| 0 | ok |
| 1 | a check, lint or validation failed |
| 2 | usage error: unknown command or flag, a missing required flag, a positional argument where the command takes none |
| 3 | precondition not met: wrong phase, missing file, dirty work tree, … |
| 4 | internal error |

- A failure prints `cw: <message>` and `Fix: <what to do>` on stderr. A `CwError` with exit 1 to 3 cannot be created without a fix (`cli/lib/out.mjs`). With `--json`, stdout carries one document `{ ok: false, code, error }`, plus `fix` and `details` when there are any.
- An output with a next step names it after `Next:`; the playbooks follow `Next:` and `Fix:` and never work around a refusal.
- Every `--task` command reads the work tree from `task.json`, never from the cwd (D5). Only `playbook show`, `playbook read`, `rules show`, `run` and `prove` take positional arguments.
- The `env` values of the config are masked in all output. `cw` never pushes and never creates a PR/MR: `cw pr command` prints the commands, and the orchestrator runs them after the user confirms (D7).

## Task state

All state lives in the config root's git common dir, `<git common dir>/dev-workflow/` (`.git/dev-workflow/` in a normal checkout, the same directory from a linked worktree). The config root is the nearest directory at or above the cwd that holds `.claude/dev-workflow/config.json`, also from inside a nested app repo (`cli/lib/workspace.mjs`).

| Path | What |
|---|---|
| `state.json` | Index of the active tasks and the tasks ended in the last ten minutes: ticket, title, phase, rounds, complexity, areas, agent ids, steps, PR URL. Rewritten on every task change; read by the mod and by G-ORCH-EDIT |
| `state.lock` | The O_EXCL lock. Every task change is a read-modify-write under it, with a `rev` check and a write-then-rename (`cli/lib/task.mjs`, `cli/lib/fsx.mjs`) |
| `hooks.log`, `hooks-cache.json`, `doctor-cache.json` | The hook log, the config and pack guards cached by file mtimes, the doctor results |
| `checks/` | Logs of `cw checks` without `--task` |
| `tasks/<id>/` | One directory per task; the id is the branch with `/` replaced by `__` |

| File in `tasks/<id>/` | Written by |
|---|---|
| `task.json`: phase, outcome, round, reviewRound, cycle, complexity, base, agents, owner session, history | every state change |
| `ticket.json`, `spec.md` | `cw ticket save`, `cw task new` (template) and `cw spec save` |
| `classify.json`: packages, areas, minimum complexity and reasons | `cw classify` |
| `brief-implementer.md`, `brief-reviewer.md` | `cw task start`, `cw task review`, `cw task return` |
| `checks-<stamp>.json` and `checks-<stamp>/` logs | `cw checks --task` |
| `proofs.json` (`proofs.lock`) | `cw prove`, `cw prove --recheck` |
| `report-<n>.json` | `cw report save` |
| `review-<n>.json`; a superseded approval as `review-<n>-r<m>.json` | `cw review save`, `cw task review` |
| `commit-msg.txt` | `cw commit msg` |
| `pr-body.md` | `cw pr body` |

### Phases, rounds and cycles

`PHASES` and `TRANSITIONS` in `cli/lib/task.mjs` are the state machine; a command that needs another phase exits 3 with the fix.

| From | To | By |
|---|---|---|
| – | spec | `cw task new` |
| spec | classify | `cw classify` |
| classify | confirm | `cw task confirm` (for the complexities in `workflow.confirm`) |
| classify, confirm | implement | `cw task start` |
| classify, confirm | spec | `cw spec save` (the complexity is dropped) |
| implement | review | `cw task review` |
| implement | classify | `cw classify` after a `misclassified` report; `cw task reset` before the next start |
| review | implement | `cw task return` (the findings; `--spec-changed` after an approval) |
| review | escalated | `cw review show`, when changes are requested in round `workflow.maxReviewRounds` |
| review | deliver | the first `cw pr …` command after an approval at the branch tip |
| deliver | review | `cw task review`, after commits on the approved branch |
| deliver | implement | `cw task return --spec-changed` |
| escalated | implement | `cw task return --continue` or `--spec-changed` |
| deliver | done | `cw task end --outcome done`, with a recorded PR/MR URL or skip reason |
| any active | escalated, aborted | `cw task end --outcome escalated\|aborted` |

- `round` counts implementer rounds: `task start` and `task return` raise it, and `report-<n>.json` and `review-<n>.json` share it.
- `reviewRound` counts the reviews of one cycle: `task review` raises it.
- `cycle` starts anew with `task return --spec-changed` or `--continue`, which set `reviewRound` back to 0.

### Workspace modes

`workspace.mode` in the config chooses one (D5).

| | in-place | worktree |
|---|---|---|
| Layout | outer project repo with the config; the application is a nested repo at `workspace.appRoot` (e.g. `app/`) | the application is the project repo |
| A task's work tree | `appRoot` | the implementer's agent worktree `.claude/worktrees/agent-<id>`, which Claude Code creates for the Agent call with `isolation: "worktree"` |
| Task branch | `cw ws setup` creates it at HEAD of a clean `appRoot` on the base branch, with `--no-track` | `cw ws setup` runs `git switch -c <branch> <base commit>` in the worktree; a rename would rewrite `.git/config`, which the sandbox refuses (§8) |
| Git form `cw` prints | `git -C <appRoot> …`, relative to the project root, where the Bash cwd stays | plain `git` in the worktree; the reviewer reads it with `cw review diff\|log\|status` (ADR 0011) |
| Parallel tasks | one started task per work tree (`cw task start` refuses a second) | one worktree per task |
| `cw task cleanup` | switches `appRoot` back to the base, only from this task's branch | removes the clean worktree and deletes `worktree-agent-<id>` unless it holds commits on no other ref |

`workTreeOf`, `gitForm` and `orchestratorTreeOf` in `cli/lib/workspace.mjs` hold these rules; the brief, `cw context`, the fix texts, `cw pr command` and the SubagentStart context all print `gitForm`. In in-place mode the compiled rules in `.claude/rules/dev-workflow/` get the `appRoot` prefix in their `paths:`.

## Hooks

`hooks/hooks.json` registers four hooks in exec form (`"command": "node"`, `"args": ["${CLAUDE_PLUGIN_ROOT}/hooks/<file>.mjs"]`). Every script runs through `runHook` (`hooks/lib/run.mjs`): it reads the JSON input, does nothing without a project config, and **fails open**: an internal error is logged to `hooks.log`, prints nothing and exits 0, and a 10 s self-limit exits 0 too. The only deliberate outputs are a guard deny and a SubagentStop block. No hook uses the network (D11).

| Hook (matcher) | Script | What |
|---|---|---|
| SessionStart (`startup\|resume`) | `session-start.mjs` | The checks of `cw doctor --quick`, without network: Node, git, config, work repo, state dir, host CLI, packs, rules drift, the ticket source (atlassian, the Linear server in `.mcp.json`, or the local ticket folder), on macOS `allowLocalBinding`. Silent when all pass; otherwise a one-line `systemMessage` plus the facts with their fixes in `additionalContext` |
| SubagentStart (`^dev-workflow:`) | `subagent-start.mjs` | Records the agent (id, type, start time, round, session) on the one task of this session that waits for its role; an implementer only on a task of its complexity, nothing when several wait. Gives the agent its role context (≤ 6,000 characters): work tree, git form, packages and checks, guards, brief file |
| SubagentStop (`^dev-workflow:(implementer-(s\|m\|l\|xl)\|reviewer)$`) | `subagent-stop.mjs` | Blocks an agent whose round file (`report-<n>.json`, `review-<n>.json`) is missing, invalid, or not newer than its start and the orchestrator's last `cw report show` / `cw review show`, naming the command to run. At most 2 blocks per agent id. Records the agent's `agent_transcript_path` for the context check of `cw task return` (ADR 0012) |
| PreToolUse (`Bash\|Agent\|Edit\|Write\|NotebookEdit`) | `guard.mjs` | The guard catalog below; deny-only, it never allows or asks, so the permission rules decide the rest |

The catalog is `hooks/lib/guards.mjs`. A workflow subagent is one whose `agent_type` is `dev-workflow:implementer-<tier>` or `dev-workflow:reviewer`; the main session has no `agent_id`. Every deny names the alternative. The guards are a backstop, not a security boundary (D12).

| Guard | Applies to | Refuses |
|---|---|---|
| G-ORCH-EDIT | the main session that owns an active task | Edit, Write, NotebookEdit of files in the project (config root, work repo, main checkout), the path taken literally |
| G-CD | that main session and workflow subagents | a `cd` or `pushd` that stays; a `( cd … && … )` subshell passes |
| G-AGENT-PARAMS | everyone | `model` or `effort` on an Agent call; in worktree mode an implementer call without `isolation: "worktree"` |
| G-FORCE | everyone | `git push --force`, `-f`, `--force-with-lease`, a `+refspec` |
| G-PUSH | workflow subagents | `git push`, `gh pr create\|new\|merge`, `glab mr create\|new\|for\|merge\|accept` |
| G-REVIEWER-WRITE | the reviewer | git write subcommands (also `config` with a value, `remote add\|remove\|…`); redirection, `tee`, `sed -i`, `cp`, `mv`, `rm`, `find -delete`, `git --output` into the project; Edit, NotebookEdit, and Write into the project |
| G-DEPS | workflow subagents | the packs' `guards.dependencyCommands` (node-npm: `npm install` and its aliases, `npm ci`, `npm update`, `npm audit fix`, …) |
| G-COMMANDS | workflow subagents | `guards.commands` of the config and the packs |
| G-PORTS | workflow subagents | a command that binds or contacts a port of `guards.ports` (config and packs); `grep`, `echo`, `cw`, a git commit and similar only mention it |
| G-DEVSERVER | workflow subagents | dev servers (`npm run dev`, `vite`, `next dev`, …) when `guards.devServer` is `never` |

The Bash parser (`hooks/lib/shell.mjs`) splits on `&& || ; | |& &` and newlines outside quotes, parses `$(…)` and backticks recursively (also inside double quotes), `bash -c`, `sh -c`, `eval` and a shell fed a heredoc, strips the wrappers `env`, `command`, `builtin`, `exec`, `nohup`, `time`, `nice`, `timeout`, `sudo`, `xargs`, and reads `/usr/bin/git` as `git`.

## How text reaches `cw`

The ticket snapshot, the spec, a corrected PR/MR body, the report and the review are written with the Write tool to a new file in the session's scratchpad directory, then passed on stdin: `cw spec save --task <id> < <scratchpad>/<id>-spec-1.md`. `cw` reads the whole text, or for JSON the last ```` ```json ```` fence in it (`cli/commands/common.mjs`).

- The orchestrator may not Write project files (G-ORCH-EDIT), and the reviewer may Write only outside the project (G-REVIEWER-WRITE); the scratchpad is outside both.
- Observation (P3 dry run, CLI 2.1.306, asking mode; PLAN §8 "Decided in P3", ADR 0004): every heredoc with JSON to `cw` asked the user, also under `Bash(cw *)`, while a Write into the scratchpad plus `cw … < <file>` ran without a prompt. A quoted heredoc stays the fallback without a scratchpad.
- The implementer never writes under `.git`, a protected path (`docs/playbooks.md`, "Nothing under `.git`"), so the commit body goes the same way: `cw commit msg --body-file -` on stdin, and `cw` writes `commit-msg.txt` itself.

## The `agents-progress` mod

`plugins/agents-progress/hooks/hooks.json` loads the module `register.tsx`; `hooks/state.ts` reads the task state and `hooks/avatars.ts` draws the costumes.

- **Source.** The mod walks up from the session's directory to `.claude/dev-workflow/config.json`, asks `git rev-parse --git-common-dir` there, and reads `dev-workflow/state.json`: once a second when its mtime changed, and right after a Bash call that starts with `cw `. Invalid JSON keeps the last good state; without the file the band stays hidden. No network and no git fetch.
- **Pane.** Every subagent with description, type, model, effort, round, status, context, tokens and time. An implementer's costume follows its task's areas in `state.json`, found by the agent id `cw task agent` recorded; the reviewer is a detective.
- **Band.** One line per active task: ticket · title · phase · `Round n/m` in review · tier · `step n/8` in implement · the PR/MR link (https only); an escalated task in the failure colour.
- **Contract.** `rebuildState` in `cli/lib/task.mjs` writes the fields and `hooks/state.ts` reads them; a change on one side needs the other and `claude plugin test plugins/agents-progress`.

## One task, end to end

| Step | Who | Commands |
|---|---|---|
| O1–O2 | orchestrator | `cw doctor --quick`, `cw task list --ticket <KEY>`, `cw ticket context --ticket <KEY>`, one ticket read (Jira or Linear through their MCP, or the local file) and the context file, AskUserQuestion |
| O3 | orchestrator | `cw task new …` (task dir, phase spec, owner session), `cw ticket save`, `cw spec save`, `cw spec lint` |
| O4–O5 | orchestrator | `cw classify`, `cw classify --set <c> --why "…"`, `cw task confirm` if required |
| O6 | orchestrator, hook | `cw task start` writes the brief and prints the Agent call; SubagentStart records the agent; `cw task agent --role implementer --id <agentId>` |
| 1–8 | implementer | `cw ws setup`, `cw context`, tests, `cw rules applicable`, `cw checks --changed`, `cw commit msg`, `git commit -F`, `cw commit lint`, `cw prove`, `cw report save`; SubagentStop lets it end |
| O7–O8 | orchestrator | `cw report show`, `cw git foreign-commits`, `cw task review` (Agent call or SendMessage), later `cw review show`; changes requested: `cw task return`, back to O7 |
| R1–R8 | reviewer | `cw review scope`, `cw checks --changed`, `cw prove --recheck`, `cw rules applicable`, `cw commit lint`, `cw review save` |
| O9 | orchestrator | `cw pr body` (task to deliver), `cw pr command`, AskUserQuestion, the printed push and create commands, `cw pr record --url` |
| O10 | orchestrator | `cw task cleanup`, `cw task end --outcome done`, a short report |
