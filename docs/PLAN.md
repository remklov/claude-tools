# dev-workflow marketplace: build plan (v1)

Status: agreed with the owner on 2026-10-19 · Owner: Benedikt Volkmer
Repository: `remklov/claude-tools` (private, GitHub, `git@github.com:remklov/claude-tools.git`)
Marketplace name: `remklov` · Plugins: `dev-workflow`, `agents-progress`

## 0. How to work on this plan

- You are a normal Claude Code session in the target repo. The owner converses in German; everything written into the repo is English.
- Step 1: move this file to `docs/PLAN.md`. Bootstrap commit on `main`: README stub, `LICENSE` (MIT; required by the savvy-progress parts of the mod), `.gitignore` (`node_modules/`, `.DS_Store`, `plugins/*/.claude-plugin/types/`, `coverage/`, `.spikes/`), `docs/PLAN.md`. Summary: `[DOCS] Add the dev-workflow build plan`. Do not push without asking.
- Work phase by phase (§14) on feature branches `NO-TICKET/feature/<2-4 words>` from `main`. Commit locally following §10. Push and open pull requests (with `gh`, on github.com) only after the owner confirms.
- **Check in after P0:** report each spike's verdict with evidence (command, output, Claude Code version, CLI or Desktop) and every change the plan-B paths make to this plan. Wait for the owner's OK before P1.
- Technical statements about Claude Code, `gh` or `glab` are backed by documentation you read or marked as an observation (who, which version). Appendix A lists facts verified on 2026-10-19; Appendix D records the P0 spike results.
- P6 (the migration of consumer projects) is NOT part of this run.

## 1. Goal and requirements

- R1 A multi-agent development workflow usable for projects of any kind and stack.
- R2 Code quality rules adjustable and extensible per stack, and per project.
- R3 Every agent works from a fixed playbook: a fixed set of skills, procedures and scripts, applied as needed, so the way of working is as deterministic as possible.
- R4 Sessions are normal by default. The workflow starts with `/dev-workflow:ticket <KEY>`; there is no default orchestrator.
- R5 Reference layout: an outer repo with the application cloned into the gitignored `app/` (in-place mode; the example project "Acme Shop" of the docs and tests); a single repo uses worktree mode. Stack: npm workspaces, React 19 + Vite, Express 5, TypeScript, Vitest, ESLint. The base setup supports this stack. fisko is the first real consumer (Appendix C).
- R6 Works with `gh` (GitHub) and `glab` (GitLab), per project.
- R7 Tickets are local Markdown files by default, one per key (`docs/tickets/{key}.md`). A project may read them from Jira or Linear instead (owner decisions 2026-10-23, ADR 0009).
- R8 Simple setup: one guided shell script registers the marketplace, installs the plugins and sets up `gh`/`glab`.
- R9 Neither plugin is ever installed automatically. `agents-progress` is opt-in per developer and per project (`--scope local`).

## 2. Sources to port from (read them; don't copy blindly)

- **Predecessor** (owned by the owner): the first version of this repository (`remklov/claude-tools` up to commit `881c8eb`), with `PLAN.md`, `plan/spec/01–08`, `docs/adr/`, `plugins/dev-workflow` (`cw` CLI, agents, playbooks, packs, hooks) and `plugins/agents-progress`. The ideas are good; the implementation has the gaps listed in §3. Project-specific parts (fisko's profile, NEXT_STEPS, NV-/OPS-… keys) stay out of the plugins, savvy stays removed, and no agent uses a Fable model.
- **An earlier project setup** with the in-place `app/` layout (works today), source of the workflow's lessons:
  - `.claude/agents/orchestrator.md`: the workflow and its lessons. In-place `app/` handling, base checks, the misclassified reset, PR reuse, ending a task.
  - `.claude/agents/code-reviewer.md`.
  - `scripts/generate-agents.mjs`: the model matrix and the complexity guardrails.
  - `.claude/rules/code-quality.md`: CQ-1…23.
  - `.claude/hooks/check-user-setup.mjs`: `allowLocalBinding --fix`.
  - A vendored copy of the progress mod, tested on 2.1.296. Keep its MIT attribution.
  - `CLAUDE.md`: the git conventions of the `default` preset.
- **An earlier marketplace** (conventions and installer lessons, Appendix B): `install.sh`, `CLAUDE.md`, `docs/architecture.md`, `tests/*.sh`, its CI config, a git-workflow skill, a ticket-kickoff skill and an Atlassian MCP plugin. It stays untouched.

## 3. Audit of the predecessor

**Keep:**
- Generalist roles with complexity tiers instead of type × size agents; domain knowledge from packs.
- Mechanics in a dependency-free CLI (`cw`), judgment in the model. `cw` prints the delegation parameters and the orchestrator passes them verbatim.
- Task state outside the repo, in the git common dir, with an explicit state machine and preconditions.
- JSON agent outputs validated by `cw`, plus a SubagentStop gate.
- Rules layered core → stack packs → project, compiled into path-scoped `.claude/rules/` with a lock file and a drift check.
- Hooks are inert without project config; every guard refusal names the alternative.
- Spikes before building, each with a plan B. Context budgets.

**Fix:**
- **In-place mode is broken.** Context discovery uses the cwd: state, base and `changedFiles` resolve to the outer repo (`scripts/lib/ctx.mjs:12-32`, `commands/tasks.mjs:52-57`, `lib/checks.mjs:44`).
  - `checks` silently selects no package and exits 0 (`commands/work.mjs:96`, `lib/report.mjs:54`).
  - `prove` deletes files when `git show` fails and records a false proof (`lib/prove.mjs:50-52`).
  - Implementers are hard-coded to `isolation: worktree` (`tools/generate-agents.mjs:67`).
  - `cleanup` uses the outer branch name (`commands/tasks.mjs:334-338`).
- **GitHub only.** No `glab` MR flow, no glab doctor, no Jira (`packs/git-github`, `lib/ticket/index.mjs`).
- **`--task` commands depend on the cwd** (`commands/common.mjs:11`, `work.mjs:238`).
- **Scratch copies copy the whole tree** (`lib/fsx.mjs:137-155`).
- **The guard is easy to bypass** (`hooks/guard-rules.mjs:34-100`): `echo "$(git push)"`, `bash -c '…'`, `/usr/bin/git`. It also denies `cp src /tmp/x` for reviewers.
- **The local state change and the remote claim are updated non-atomically** (`commands/tasks.mjs:247-248`).
- **Thin test coverage:** 6 test files for 29 modules; no tests for in-place, GitLab or lock contention; temp dirs leak (`tests/helpers/repo.mjs:65`).
- **Every Bash call costs about 4 git spawns** in profiled repos (`ctx.mjs`), and SessionStart touches the network (`doctor.mjs:69`).

**Drop:** remote-ref claims, ID reservation, the merge driver and the markdown-table backlog. They exist only for a backlog file in the repo; the source of truth is the ticket's file or ticket system (D6). Also drop the ticket-intent UserPromptSubmit hook, `agents eject` (it silently disables the hooks), rule aliases, yaml-lite and deploy-impact.

**Defer:** the investigator role; `mutate` (replaced by `prove --recheck`); builds-on sub-task chains; `base-moved`; Docker and CI packs.

## 4. Architecture decisions

- **D1 Two plugins in one marketplace**, both listed by relative path (`./plugins/…`).
  - No dependency between them: `dev-workflow` must not declare `agents-progress` in `dependencies`, because that would auto-install it (documented, Appendix A).
  - No root `settings.json` in either plugin.
- **D2 Entry is `/dev-workflow:ticket <TICKET-KEY | NO-TICKET> [notes]`**, with `disable-model-invocation: true`.
  - No plugin `agent` setting: that would make every session the orchestrator (documented).
  - No prompt-guessing hook. A session without the command is a normal session.
- **D3 The orchestrator is the main session while a task runs.** The `ticket` skill is its playbook, with a SKILL.md, step files and reference files; the orchestrator reads the step and reference files with `cw playbook read`, because the Read tool asks before a file outside the working directory (documented, code.claude.com/docs/en/permissions) and the plugin lies outside the project.
  - A PreToolUse guard (G-ORCH-EDIT) refuses Edit/Write/NotebookEdit in the session that owns an active task, until `cw task end`.
  - A skill's `disallowed-tools` only applies while the skill is active and clears with the next user message (documented), so the hook is required.
  - Session binding (S3): `cw task new` records `CLAUDE_CODE_SESSION_ID` as the task's owner session. It equals the hook input's `session_id`, and subagents share it, so the guard recognises the main session by the owner `session_id` plus a missing `agent_id`. `/clear` and `--fork-session` give a new id (documented), so the binding ends there. Running `/dev-workflow:ticket <KEY>` again offers to rebind an active task of that key: after the user confirms, `cw task new --rebind <id>` makes the current session the owner (owner decision at the P0 check-in). The no-ticket key never rebinds implicitly: the orchestrator lists the active `NO-TICKET` tasks and asks.
- **D4 Generalist agents.**
  - `implementer-s|m|l|xl`, generated from one matrix:

    | Tier | Model | Effort |
    |---|---|---|
    | s | `claude-sonnet-5-5` | low |
    | m | `claude-sonnet-5-5` | medium |
    | l | `claude-opus-5-5` | medium |
    | xl | `claude-opus-5-5` | high |

  - `reviewer`: `claude-opus-5-5`, high, read-only (`disallowedTools: Edit, Agent`; Write only for its review file outside the project, enforced by G-REVIEWER-WRITE, owner decision 2026-10-21).
  - Implementers: `tools: Read, Edit, Write, Grep, Glob, Bash`, `disallowedTools: Agent`, `skills: [dev-workflow:implementer-playbook]`.
  - `implementer-playbook` and `reviewer-playbook` set `user-invocable: false` and never `disable-model-invocation: true`: a skill with `disable-model-invocation` is not preloaded (S1, documented).
  - No `isolation` in frontmatter. In worktree mode `cw task start` prints `isolation: "worktree"` for the Agent call, and guard G-AGENT-PARAMS refuses an implementer call without it (S4: the per-call parameter works for plugin agents, and PreToolUse sees it in `tool_input`).
  - Main-session Agent calls without `run_in_background` ran in the background (headless CLI 2.1.296 and 2.1.303). `cw task start` and `cw task review` therefore print `run_in_background: false`, so the orchestrator waits for the report. Whether a SendMessage continuation (O7, O8) waits for the next report is untested; P3 covers it. Observed in the P3 dry run: the Agent tool of the interactive CLI 2.1.306 and of the Desktop app has no `run_in_background`, and every subagent runs in the background; the orchestrator then waits until the report arrives as a message (ticket skill, ground rule 10).
  - In the Desktop app a subagent hands its report back through `SubagentHandback`, and the Agent result only points to it (S7, Desktop 2.1.299). The orchestrator therefore reads reports with `cw report show` / `cw review show`, never from the Agent result text.
  - Ignored plugin-agent fields (`permissionMode`, `hooks`, `mcpServers`, `initialPrompt`) are never written.
- **D5 Workspace modes.**
  - `in-place`: the application is a nested repo (`workspace.appRoot`, e.g. `app`). One implementer per work tree at a time.
  - `worktree`: the application is the repo root; one worktree per task, so parallel tasks are possible.
  - The config root is found by walking **up from the cwd** to `.claude/dev-workflow/config.json`, crossing nested git roots, so it also works from inside `app/`.
  - All git and check operations target the **work repo**: `appRoot`, or the task's worktree.
  - Task state lives in the config root's git common dir, at `.git/dev-workflow/`.
  - Every `--task` command resolves its work tree from `task.json`, never from the cwd.
  - Worktree mode (S4): Claude Code creates `<repo>/.claude/worktrees/agent-<id>` on branch `worktree-agent-<id>`, based on `worktree.baseRef` (`head` = the local HEAD; the default `fresh` = `origin/HEAD`). `cw ws setup` creates the task branch there with `git switch -c` instead of renaming: a rename rewrites `.git/config`, which the sandbox refuses (§8). It refuses a worktree whose HEAD has commits on no other ref, so nothing is left behind on `worktree-agent-<id>`. `cw task cleanup` removes the clean worktree and deletes `worktree-agent-<id>` unless commits on it are on no other ref (then it is kept and named).
  - In a worktree-isolated agent the harness refuses git commands it can't confine to the worktree, such as `git -C "$(pwd)" …`; plain `git …` in the worktree and executables such as `cw` that run git themselves pass (headless CLI 2.1.296 and 2.1.303). Observed in the P3 dry run (interactive CLI 2.1.308): the harness refused `cw git lint --task <id>` ("runs cw with a git command among its operands"), while `cw commit msg`, `git commit -F <message file under the main .git>`, `cw prove` and `cw report save` passed, so the command is `cw commit lint` now (owner decision 2026-10-22). Claude Code puts the worktree under `.claude/worktrees/`, a protected path, so every Edit and Write of the implementer there asks in the default and acceptEdits modes. The Bash tool keeps its cwd between calls, and a subagent starts in the main session's current cwd (same runs): another reason the orchestrator never uses `cd`.
- **D6 One ticket read, never a write.**
  - The source is `tickets.source`: `local` (the default), `jira` or `linear` (owner decisions 2026-10-23, ADR 0009). In O1 `cw ticket context --ticket <KEY>` names the source and the file of the key at `tickets.contextPath`. Reading Jira and Linear is model-mediated, because a script can't call MCP tools.
  - `linear`: Linear's read-only endpoint `https://mcp.linear.app/mcp/readonly` (it "only ever exposes read tools", linear.app/docs/mcp), named in the project's `.mcp.json`; tool names follow `mcp__<server>__<tool>` (code.claude.com/docs/en/mcp). One call (S11): `get_issue` with `{ "id": "<KEY>" }`; the issue's `id`, `title`, `description`, `status`, `assignee` and `url` fill the snapshot.
  - `local`: the file at `tickets.contextPath` (default `docs/tickets/{key}.md`) is the ticket; the snapshot keeps its `path`.
  - `jira` and `linear` with a `contextPath`: the file of the key, if it exists, is technical context; the orchestrator reads it with the ticket, the snapshot keeps its path as `context`, and the brief names it.
  - Jira: the orchestrator reads the issue through the MCP server of Atlassian's `atlassian` plugin (official marketplace `claude-plugins-official`). Tool names follow `mcp__plugin_atlassian_atlassian__*` (derived from the plugin's `.mcp.json`, server `atlassian`; S10 observed the same tools through another plugin's `atlassian` server); most need a `cloudId`.
    - One call (S10): `getJiraIssue` with `cloudId` = the site host from `tickets.site` (no discovery call), `issueIdOrKey`, `fields: [summary, description, status, assignee, issuetype]`, `responseContentFormat: "markdown"`, `updateHistory: false`. The issue is `issues.nodes[0]` (`key`, `fields.*`, `webUrl`). If the host is refused, `getAccessibleAtlassianResources` returns the `id` to use.
    - Acceptance criteria: S10 requested no such field, and whether the site has an acceptance-criteria custom field was not checked. The orchestrator takes them from the description or the kickoff plan and confirms them in O2.
    - The snapshot (key, summary, description, acceptance criteria, status, assignee, url) is stored with `cw ticket save --task <id>` (stdin JSON) in O3, once the task exists.
  - If `.claude/plans/<KEY>.md` exists (a kickoff plan, written by a planning skill or by hand), it is read as input.
  - If the MCP is missing or not logged in: tell the user (the one-time `/mcp` login) and ask them to paste the ticket text, or continue from the command's notes.
  - No writes to any ticket system; the ticket's assignee is the team-level claim. In-place mode allows one active task per work tree (`cw task start` enforces it).
- **D7 Git hosts.**
  - Adapters `github` (`gh`) and `gitlab` (`glab`), detected from the work repo's `origin`, with a config override.
  - `cw` never pushes and never creates a PR/MR. `cw pr command --task` prints the exact commands, and the orchestrator runs them via Bash after AskUserQuestion confirmation, so the `ask` permissions apply. Flags in Appendix A.
  - An existing PR/MR is detected first. If one exists, push only and record its URL.
- **D8 Git conventions as data** (§10): preset `default`.
- **D9 `agents-progress` reads the state file** (§11). Plan B: the `progress` tool fed with JSON that `cw` prints.
- **D10 Runtime.**
  - Node ≥ 20, ESM, no npm dependencies, no build step, for `cw` and the hooks.
  - The `cw` shim lives in the plugin's `bin/`, which is on the Bash tool's PATH (documented).
  - `cw` finds its own files via `import.meta.url`, because `CLAUDE_PLUGIN_ROOT` doesn't reach Bash commands (documented).
  - The minimum Claude Code version is 2.1.296: every headless spike passed on 2.1.296 and on 2.1.303. The mod APIs of S5 were observed on CLI 2.1.303 and in the Desktop app (engine 2.1.299) only, so P4 rechecks them on 2.1.296. The CLI updates itself (2.1.296 → 2.1.303 during P0) and the Desktop app bundles its own engine, so evidence and bug reports name the surface and its version.
- **D11 Performance and safety of hooks.**
  - No network in hooks.
  - The resolved config and packs are cached by file mtimes in the state dir.
  - Hooks fail open on internal errors and log to `.git/dev-workflow/hooks.log`. The deliberate exceptions are guard denies and SubagentStop blocks.
  - Typical cost: < 300 ms.
- **D12 The guards are a backstop, not a security boundary.** Keep the catalog small (§9); the earlier marketplace recorded that deny lists mostly cost friction.

## 5. Project config contract: `.claude/dev-workflow/config.json`

Validated by a short hand-written validator with readable errors (path + message). Example for the reference layout (Acme Shop):

```json
{
  "version": 1,
  "project": { "name": "Acme Shop", "language": { "repo": "en", "productCopy": "de" } },
  "workspace": { "mode": "in-place", "appRoot": "app" },
  "packs": [
    "node-npm",
    "typescript",
    { "id": "express", "variant": "5", "options": { "appEntry": "createApp()" } },
    { "id": "react-vite", "variant": "react-19" },
    "vitest"
  ],
  "packages": [
    { "id": "app", "path": ".", "areas": ["frontend", "backend"],
      "checks": { "test": "npm test", "typecheck": "npm run typecheck", "lint": "npm run lint" } }
  ],
  "git": { "preset": "default", "defaultBase": "main", "noTicketKey": "NO-TICKET" },
  "tickets": { "source": "jira", "site": "example.atlassian.net", "keyPattern": "^[A-Z][A-Z0-9]+-[0-9]+$" },
  "workflow": { "maxReviewRounds": 3, "confirm": ["l", "xl"], "maxQuestionsPerRound": 4 },
  "guards": { "ports": [], "commands": [], "devServer": "allowed" },
  "complexity": { "escalate": [] },
  "rules": { "add": [], "disable": [], "extend": {}, "override": {}, "options": {}, "allowProtected": false }
}
```

- **Package paths** are relative to the work repo root. A file belongs to the package with the longest matching path. `checks` run with `cwd = <work tree>/<path>`.
- **Optional keys** (decided in P2): `packages[].env` (values masked in all output; `cw config show` masks every value, and values shorter than 6 characters are not masked inside logs and messages, which `cw config validate` warns about), `packages[].testSingle` (the single-test command; it must contain `{file}` (outside the optional `[ … {name} … ]` segment) and may contain `{name}`; a placeholder is either quoted on its own (`"{file}"`) or unquoted with no quote, `$` or `\` next to it; overrides the pack's `testRunner.single`), `workflow.checkTimeoutMinutes` (default 15), `git.host` (`github` or `gitlab`; overrides the detection, D7), `tickets.site` (the Jira host, D6).
- **`tickets`** (owner decisions 2026-10-23, ADR 0009): `source` `local|jira|linear` (default `local`); `site` for Jira only, without a default (without it the orchestrator looks the site up once); `contextPath`, a path relative to the project root with `{key}` (no leading `/`, no `..`): the ticket files for `local` (default `docs/tickets/{key}.md`), optional technical context for `jira` and `linear`.
- **`rules` shapes**: `add: [path]`, `disable: [{ id, reason }]`, `extend: { ID: markdown }`, `override: { ID: { file, reason } }` (`reason` required for a protected rule), `options: { ID: { … } }`, `allowProtected`.
- **`complexity.escalate`** items: `{ paths?: glob[], keywords?: string[], min: "s|m|l|xl", reason }`. They set the classification minimum; going below it needs `--override "<reason>"` approved by the user.
- **Other project files:**
  - `.claude/dev-workflow/rules/*.md`: project rules, same grammar as pack rules, with a project ID prefix.
  - `.claude/dev-workflow/procedures/<role>/*.md`: project procedures.
  - `.claude/dev-workflow/packs/<id>/`: project-local packs.
  - `.claude/dev-workflow/rulebook.lock.json`.
- **Generated output:** `.claude/rules/dev-workflow/*.md`. In in-place mode its `paths:` globs are prefixed with `appRoot`, so normal sessions in the outer repo get the rules too.

## 6. Playbooks (R3)

Each role gets a fixed set, shown by `cw playbook show <role> [--task <id>]` and documented in `docs/playbooks.md`:

1. **Role skill**: the `ticket` skill for the orchestrator; `implementer-playbook` and `reviewer-playbook`, preloaded via `skills:` (the full content is injected, documented). Fixed steps, each naming the `cw` command that does its mechanical part. Budgets: SKILL.md ≤ 200 lines, step file ≤ 80, reference ≤ 150 (checked by repo-lint).
2. **Procedures** from active packs and the project. Frontmatter: `name`, `role`, `description`, `when.paths|areas|keywords|phases`, `scripts`, `rules`. `cw task start` and `cw task review` select them deterministically and **inline their full text into the brief**.
3. **Scripts:** `cw` commands, plus pack scripts via `cw run <pack>:<script>`.
4. **Output contract:** JSON validated by `cw report save` / `cw review save`, enforced by the SubagentStop gate.
5. **Guards:** §9.

**Orchestrator** (main session via `/dev-workflow:ticket`). Ground rules: never `cd` (absolute paths, `git -C`, subshells); delegate with exactly what `cw` prints; one implementer per task.

| Step | What | Commands |
|---|---|---|
| O1 | Intake | `cw doctor --quick`; parse the argument; an active task for the ticket (`cw task list`) → ask, then `cw task new --rebind <id>` and resume at its phase (D3); `cw ticket context --ticket <KEY>`, then one ticket read from `tickets.source` (Jira or Linear via MCP, or the local file) and the context file if it exists (D6); read `.claude/plans/<KEY>.md` if present; use the Explore agent for wide searches, with `run_in_background: false` |
| O2 | Clarify | AskUserQuestion until the requirements and acceptance criteria are testable; ≤ `maxQuestionsPerRound`. A check only a person can do is no acceptance criterion: it goes into the Definition of done as a manual check and into the report as a `manual` open point |
| O3 | Spec | `cw task new` (branch from the preset), `cw ticket save --task <id>` (snapshot incl. the acceptance criteria confirmed in O2), write the spec, `cw spec save`, `cw spec lint`. Rule references quote the rule ID and wording. Technical claims are backed by docs or marked as observations. No attribution lines |
| O4 | Classify | `cw classify` (packages, areas, minimum), then `cw classify --set <c> --why "<one sentence>"`. Between two levels, pick the higher one |
| O5 | Confirm | Complexities in `workflow.confirm`: show the spec summary and classification, AskUserQuestion, `cw task confirm` |
| O6 | Delegate | `cw task start` → Agent call with exactly `subagent_type`, `description`, `prompt`, `run_in_background: false` (+ `isolation` in worktree mode) → `cw task agent --role implementer --id <agentId>` |
| O7 | Handle the report | `cw report show --task <id>` (D4) → `done` → O8. `blocked` → answer from spec/code via SendMessage to the SAME agent, else ask the user. `misclassified` → reclassify, tell the user old and new, confirm if needed; `cw task reset` performs or refuses the reset per the Acme Shop rules |
| O8 | Review loop | `cw git foreign-commits` (rebase request to the same implementer if needed) → `cw task review` (first round: Agent call; later rounds: SendMessage to the SAME reviewer) → `cw review show --task <id>` → `changes_requested`: `cw task return` → SendMessage to the SAME implementer. Max rounds → escalate to the user. A spec change after approval restarts the cycle |
| O9 | Deliver | `cw pr body`; `cw pr command` (host, existing PR/MR, push + create commands); unpushed commits on the base branch → ask first; AskUserQuestion naming exactly what is pushed; run the commands; `cw pr record --url` |
| O10 | Close | `cw task cleanup` (in-place: switch `appRoot` back to base if it is clean and on this task's branch; worktree: remove the clean worktree), `cw task end`, short report (classification, review rounds, PR link) |

**The misclassified reset** (in-place), decided by `cw task reset`:

| State | Action |
|---|---|
| Branch missing, work tree clean on base | Nothing to do |
| Branch exists, clean, no commits | `switch <base>` + `branch -D <branch>` |
| Dirty, or the branch has commits | Exit 3; the orchestrator asks the user |

**Implementer** (`implementer-playbook`):

1. `cw ws setup`.
   - In-place: work tree clean and on the recorded base branch → create the task branch; otherwise report `blocked`.
   - Worktree: create the task branch with `git switch -c` (D5).
2. Read the brief (spec, ticket snapshot, packages and checks, inlined procedures, applicable rule IDs with titles, guardrails), then `cw context`. Read the code first. An ambiguous or contradicting AC → `blocked`.
3. Tests first: one or more per AC; a regression test for bug fixes. Manual checks of the Definition of done need no test.
4. Implement within scope (CORE-SCOPE); no dependency changes (→ `blocked`).
5. `cw checks --changed`: fix until green; never loosen checks.
6. `git add`, `cw commit msg …` (it writes the message file in the task dir; the body comes on stdin with `--body-file -`, attribution lines with `--trailer`; the agent never writes under `.git`, a protected path whose writes are prompted and which no allow rule covers), then `git commit -F <that file>`, then `cw commit lint`. Worktree mode: plain `git` in the worktree, no `git -C` and no command substitution around git; in-place mode: `git -C <appRoot>` relative to the project root, the form `cw context` prints (D5; the Bash cwd stays at the project root, owner decision 2026-10-20).
7. `cw prove` for each new test. A bug fix needs the regression test's failing run.
8. `cw report save` (stdin); the final message is exactly its JSON fence.

The complexity guardrails come from the Acme Shop generator (s/m/l/xl texts). On review findings: fix every blocking finding plus the ones flagged "also", repeat steps 5–8, and report again.

**Reviewer** (`reviewer-playbook`, read-only):

| Step | What |
|---|---|
| R1 | `cw review scope`: diff stat, files outside the packages, foreign commits, uncommitted changes and added `node_modules` paths (blocking), non-goal hints, pack scope scripts (`vitest:no-focus`, `node-npm:dependency-changes`; a failing one is blocking unless a non-blocking finding with rule `scope` names the script and says why it is accepted, e.g. the user approved the dependency in O7; a script that did not finish its check cannot be accepted) |
| R2 | `cw checks --changed`, run in the task's work tree whatever the cwd. A failing check is blocking |
| R3 | Each AC with named proof; `cw prove --recheck` re-runs the recorded proofs that held (stale ones, whose test or change file is gone, are listed, not counted). A test that doesn't fail without the change is a blocking CORE-TEST-SPEC finding (rule `spec` where CORE-TEST-SPEC does not apply); so is a criterion without a test. A manual check of the Definition of done needs no test and is no finding |
| R4 | `cw rules applicable --task` → check each rule; cite rule IDs. `rulesChecked` must equal that set |
| R5 | Reviewer procedures |
| R6 | Correctness and security beyond the rules |
| R7 | `cw commit lint --task` |
| R8 | `cw review save`. Mark cheap non-blocking findings `sendAlong`. Style preferences without a rule are never blocking |

## 7. Rules (R2)

**Grammar** (from the predecessor's spec 01 §3):

```markdown
## RULE-ID — Title
<!-- rule: severity=blocking|advisory; scope=all|areas:a,b|paths:g1|g2; protected=true|false -->
Body until the next "## ".
```

- Placeholders: `{options.x}`, `{ruleOptions.x}`, `{project.language.repo}`, `{project.language.productCopy}`. An unresolved placeholder is a build error.
- The meta key `when=option:<name>[=<value>]` activates a rule only for that pack option (TS-ESM-IMPORTS, RTL-CLEANUP; decided in P2).
- Project rules: every `.claude/dev-workflow/rules/*.md` is loaded; `rules.add` lists further files.
- A variant file may redefine a base rule ID.
- Build errors: duplicate IDs, unknown IDs in `disable`/`extend`/`override`/`options`, a protected rule disabled or overridden without `allowProtected` and a reason.

**Layering:**
1. `core`: always active.
2. Packs: `requires` first, then config order; base file, then the variant file.
3. Project: `add` → `override` → `extend` → `disable`. Disabled rules are listed with their reason in the generated global file.

**Output** in `.claude/rules/dev-workflow/`:
- `00-global.md` with the preamble from today's code-quality.md, generalized. It includes "the spec wins over a rule, except for protected rules".
- `area-<areas>.md` (several areas joined with `+`) and `paths-<pack>-<n>.md` with `paths:` frontmatter.
- A marker line in every file. Stale marked files are deleted.

**Queries:** `cw rules build [--check]`, `list`, `show <ID>`, `applicable --task <id>` (global rules plus the scoped rules matching the changed files or the task's areas from `classify`; JSON includes the full text).

Decided in P2: in in-place mode `00-global.md` also gets `paths: <appRoot>/**`, so setup work in the outer repo does not get the application's rules. A plugin or pack version bump alone is not drift. Pack procedures live in `packs/<id>/procedures/<role>/*.md`, and packs declare their review scope scripts in `pack.json`.

**v1 packs** (port the texts from Acme Shop's code-quality.md and the predecessor's packs). 🔒 = protected.

| Pack | Rules | Procedures | Scripts |
|---|---|---|---|
| `core` | CORE-SCOPE, CORE-SIMPLICITY, CORE-NAMING (`{options.abbreviations}`), CORE-STRUCTURE, CORE-COMMENTS (`{options.todoFormat}`), CORE-ERRORS, CORE-TEST-SPEC, CORE-TEST-BEHAVIOUR, CORE-TEST-DETERMINISTIC, CORE-TEST-HONEST, CORE-DEPENDENCIES, CORE-REPRODUCIBLE-BUILDS (`paths: **/Dockerfile*\|**/*compose*.y*ml\|.github/workflows/**\|**/.gitlab-ci.yml`), CORE-LANGUAGE, CORE-SECRETS 🔒, CORE-INJECTION 🔒, CORE-LOGGING 🔒 | – | – |
| `node-npm` | NPM-WORKSPACE-IMPORTS, NPM-CI | investigator procedures later | `check-discovery`, `dependency-changes` |
| `typescript` | TS-NO-ANY, TS-NO-CAST, TS-ESM-IMPORTS (active only with option `moduleResolution=nodenext`) | `implementer/narrow-unknown` | – |
| `express` (5, 4) | EXPRESS-ASYNC-ERRORS, EXPRESS-ERROR-RESPONSES, EXPRESS-RESPONSE-FLOW, EXPRESS-INPUT-VALIDATION, EXPRESS-SUPERTEST (`{options.appEntry}`) | `implementer/express-route` | – |
| `react-vite` (react-19, react-18) | REACT-A11Y, REACT-FETCH-OK, REACT-EFFECT-CLEANUP, REACT-NO-RAW-HTML 🔒, VITE-ENV-SECRETS 🔒, RTL-QUERIES, RTL-CLEANUP (inactive when `vitestGlobals` is true) | `implementer/ui-change`, `reviewer/ui-review` | – |
| `vitest` | VITEST-NO-FOCUS, VITEST-TIMERS; `testRunner.single: npx vitest run {file} [-t "{name}"]` | – | `no-focus` |

**Acme Shop CQ → successor** (`docs/migration/cq-rules.md`, plus a test that every target ID exists):

| Old rule | Successor |
|---|---|
| CQ-1 | CORE-SCOPE |
| CQ-2 | CORE-SIMPLICITY |
| CQ-3 | CORE-NAMING |
| CQ-4 | CORE-STRUCTURE |
| CQ-5 | CORE-COMMENTS |
| CQ-6 | CORE-DEPENDENCIES + NPM-WORKSPACE-IMPORTS |
| CQ-7 | TS-NO-ANY + EXPRESS-INPUT-VALIDATION |
| CQ-8 | TS-NO-CAST |
| CQ-9 | CORE-ERRORS |
| CQ-10 | EXPRESS-ASYNC-ERRORS + EXPRESS-ERROR-RESPONSES |
| CQ-11 | EXPRESS-RESPONSE-FLOW |
| CQ-12 | CORE-TEST-SPEC |
| CQ-13 | CORE-TEST-BEHAVIOUR + EXPRESS-SUPERTEST + RTL-QUERIES |
| CQ-14 | CORE-TEST-DETERMINISTIC + VITEST-TIMERS |
| CQ-15 | RTL-CLEANUP |
| CQ-16 | CORE-TEST-HONEST + VITEST-NO-FOCUS |
| CQ-17 | REACT-A11Y |
| CQ-18 | REACT-FETCH-OK |
| CQ-19 | REACT-EFFECT-CLEANUP |
| CQ-20 | CORE-SECRETS + VITE-ENV-SECRETS |
| CQ-21 | CORE-INJECTION + REACT-NO-RAW-HTML |
| CQ-22 | CORE-LOGGING |
| CQ-23 | CORE-REPRODUCIBLE-BUILDS + NPM-CI |

The Acme Shop CLAUDE.md conventions map too: `createApp()` + supertest → EXPRESS-SUPERTEST; `.js` imports → TS-ESM-IMPORTS; language → CORE-LANGUAGE. The frontend component style becomes a project rule.

## 8. `cw` CLI v1

Conventions:
- `cw <command> [sub] [options]`; `--json` for machine output.
- Exit codes: 0 ok · 1 check/lint/validation failed · 2 usage error · 3 precondition not met · 4 internal error.
- Every failure names the fix. Environment values from the config are masked in logs.
- Writes only to: the state dir; temp worktrees (removed in `finally`); the repo for `init --write`, `init --interactive` and `rules build`; a `commit msg --out` file outside the work tree; and, through git, the work repo's branches, HEAD and worktrees for `ws setup`, `task reset` and `task cleanup`.
- Inside Claude Code (`CLAUDECODE=1` in the Bash env, documented) `cw` never writes `.claude/settings*.json`: the sandbox protects the session's own settings files (documented; EPERM in S8), so `init --write` refuses there and names `setup.sh`. The state dir and `.claude/rules/dev-workflow/` are writable under the sandbox, also from worktree agents (S8).
- No git command that rewrites `.git/config` (`branch -m`, `branch --set-upstream-to`, `push -u`, `remote set-head`): the sandbox refuses the write (S8, where `branch -D` still deleted the branch but warned). Temp dirs come from `os.tmpdir()`, which the sandbox points at its writable temp dir.

| Area | Commands |
|---|---|
| Setup / inspection | `init --detect \| --interactive [--yes] [--force] \| --write <file> [--force]`, `doctor [--hook] [--quick] [--fresh]`, `config show`, `config validate [--file <path>]`, `playbook show <role> [--task]`, `rules build [--check]\|list\|show\|applicable`, `version`, `help [cmd]` |
| Orchestrator | `task new --ticket <KEY\|NO-TICKET> --slug --title --type feature\|bugfix\|hotfix`, `task new --rebind <id>`, `ticket context --ticket <KEY>`, `ticket save`, `spec save\|show\|lint`, `classify [--paths]`, `classify --set --why [--override "<reason>"]`, `task confirm --note`, `task start [--base <branch>] [--new-agent]`, `task agent --role --id`, `report show`, `review show`, `task reset [--keep --note]`, `git foreign-commits`, `task review [--new-agent]`, `task return [--spec-changed --note \| --continue --note] [--new-agent]`, `pr title\|body\|command`, `pr body --stdin`, `pr record --url \| --skipped <reason>`, `task cleanup`, `task end --outcome done\|escalated\|aborted [--note]`, `task list\|show`, `task list [--all] [--ticket <KEY>]`, `playbook read steps/<file>\|reference/<file>` |
| Implementer | `ws setup`, `context`, `checks [--task] [--changed] [--package] [--only]`, `commit msg --summary --keyword [--flag] [--body-file <file>|-] [--trailer "<Key: value>"]… [--out <file outside the work tree>]`, `commit lint [--last]`, `prove --test <pkg>:<file>[::<name>] --change <file>…`, `report save`, `step --done <n> [--note]`, `run <pack>:<script> [--task] [--base <ref>] [-- <args>]` |
| Reviewer | `review scope`, `prove --recheck`, `review save` |

**Phases:** spec → classify → (confirm) → implement → review → deliver → done, plus `escalated` and `aborted`. Preconditions as in the predecessor's spec 01 §5.3, minus claims.

**Decided in P2** (gaps the plan left open):
- `task return --spec-changed` (deliver, escalated or an approved review → implement after a spec change, O8) and `--continue` (escalated → implement after the user's decision); `task review` and `task return` take `--new-agent` to print a fresh Agent call when the recorded agent belongs to an earlier session (D3 rebind).
- `task reset` in worktree mode: a clean worktree without commits is removed with its branches; anything else is exit 3, as in-place.
- `pr record --skipped <reason>` ends delivery without a PR/MR (no remote or no supported host).
- `commit msg --out` is optional (default: the task dir); a path inside the work tree is refused.
- `task start --base` defaults to `git.defaultBase` and names an existing local branch of the work repo.
- `checks` records the content tree id of the work tree; `report save` and `review save` require it to match the current tree, so a stale check run does not count.
- `NO-TICKET` is accepted as an alias of `git.noTicketKey`.
- PR/MR title: the oldest task commit's summary with the flags of later commits. The body ends with `Relates to <KEY>`, except for the no-ticket key. An existing merged or closed PR/MR for the branch is exit 3, and the orchestrator asks the user.
- `ws setup`: in-place, a clean work tree on the base branch gets the task branch at its HEAD and `base.commit` records that HEAD; in worktree mode, `git switch -c <task branch> <base.commit>`.
- Rounds: `round` counts implementer rounds, and `report-<n>.json` and `review-<n>.json` share it; `reviewRound` counts the reviews of one cycle. `task return --continue` and `--spec-changed` start a new cycle (`reviewRound` 0). `review show` moves the task to `escalated` when changes are requested in round `maxReviewRounds`.
- `task return --new-agent` in worktree mode releases the old agent's clean worktree (removed, task branch kept); the new agent's `ws setup` switches its own worktree to the existing task branch, because git refuses a branch that another worktree holds.
- `classify` after `task start` only follows a `misclassified` report; it marks the task `resetPending`, and `task start` refuses until `task reset` ran. `task reset` is allowed from `spec` to `implement` and is idempotent.
- `spec save` is allowed in `implement` while the round's report is `blocked` (the answer may change the spec); it rewrites the implementer brief.
- `report show` and `review show` stamp `agents.<role>.shownAt`. The P3 SubagentStop gate counts a report as new only when it was saved after both `startedAt` and `shownAt`, so an agent continued by SendMessage must save again.
- Single-test commands: one renderer for `testRunner.single` and `packages[].testSingle`; the test name is regex-escaped (vitest `-t` and `node --test-name-pattern` take a regexp), and both values are shell-quoted.

**Decided in the P2 review** (each closes a confirmed finding; tests cover them):
- Recovery without a live agent: `task start --new-agent` in `implement` when the round's report is missing or `blocked` re-delegates the same round. `task agent` records the session; an agent of an earlier session (after a rebind) is stale, so `task review` and `task return` print a fresh Agent call for it, and no next step or fix tells to SendMessage it. The rebind output lists stale agents.
- The brief is rendered before the phase changes (task start, task review, task return), so a broken procedure or rule file leaves the task where it was.
- `task reset --keep --note "<user decision>"` keeps a misclassified task's committed work and continues its branch. `task reset` refuses a dirty tree, commits (offering `--keep`), a task branch that existed before `task start` (cw did not create it), and in `implement` the live implementer's worktree.
- `task return --continue` needs `--note` with the user's decision; the note reaches the implementer's message and brief.
- A commit on an approved branch: `task review` starts a new review round over the commits since the approved head, from `review` or `deliver` (edge deliver → review); the superseded approval stays as `review-<round>-r<n>.json`.
- A spec change after an approval (in `review` or `deliver`) or in `escalated` sets `specChanged`; every `pr` command and `task return --continue` refuse until `task return --spec-changed`. `pr-body.md` is deleted when the task leaves `deliver`; `pr body --stdin` keeps the trailers at the end and refuses sections the preset does not know.
- `review show` is read-only in `escalated`, so the findings stay visible for the user's decision.
- The task branch is kept for the task (`resumeBranch`, with its reason `resumeBranchBy`: keep, handover or cleanup) after a handover, a cleanup of a started task or `reset --keep`; `ws setup` then switches to it instead of creating it, in both modes. A fresh `task start` keeps only a keep or handover reason; a never-started task gets none, so a branch cw did not create is never taken over. In-place `ws setup` creates the branch with `--no-track`, so a global `branch.autoSetupMerge` never writes `.git/config`.
- In-place `task cleanup` switches `app/` back to the base only from this task's branch.
- `prove`: a control run at HEAD in the temporary tree; `--recheck` re-runs only proofs that held; a proof whose test or change file is gone is stale (listed, not counted). Changed files count both sides of a rename.
- `review save` refuses an approval unless `rulesChecked` equals `cw rules applicable --task`, a current checks result passed (every package with changed files, not `--only`), the newest recheck after the report was made at the reviewed head when proofs exist, a bug fix has a proof that held, and `review scope` lists no foreign commit, uncommitted change or added `node_modules` path. A failing pack scope script needs a non-blocking finding with rule `scope` that names the script and says why it is accepted (for example a dependency the user approved in O7); script references and file names are no reason, and a script that did not finish its check (an exit other than 1, a timeout) cannot be accepted.
- `spec lint`: list items with any marker count; AC and R ids have no leading zeros; in in-place mode an `<appRoot>/` path is an error unless it exists in the work repo or the work repo has its own `<appRoot>/` directory (Next.js, Laravel, Rails), where it is a warning.
- `commit lint` also checks the PR/MR title built from all commits against the summary limit.
- Only `playbook show`, `playbook read`, `rules show`, `run` and `prove` take positional arguments; any other gets exit 2. `--json`: `help` prints JSON, an internal error prints a JSON document, failing results carry `fix`, and `cw run` refuses `--json`.
- The PR/MR host is read from `git remote get-url origin` (url.<base>.insteadOf applied). An ssh host alias (`git@github-work:…`) is not resolved; open point: a config key for the host name.
- A task branch that exists at `task start` and is not kept for the task (`branchPreexisted`) is the user's: `ws setup` reports blocked and `task reset` refuses to delete it.
- In worktree mode a re-review after the approval needs the implementer worktree; without it `task review` refuses and names two ways: reset the branch to the approved commit, or a new round through `cw spec save` and `task return --spec-changed --new-agent`.
- `commit lint`'s PR/MR title finding is advisory once the branch is pushed or its PR/MR recorded (a rebuild would need a force push); `pr command` builds the title only when it creates the PR/MR.
- `git foreign-commits --json` returns the git `command` and the `fix` text separately; for an implementer of an earlier session the fix goes through `task review` and `task return --new-agent`.
- `spec lint` reads a dotted sub-id (`AC1.1`, `R1.1`) as a note of its parent, and `AC3.` like `AC3:`.

**Decided in P3** (each covered by tests; the dry run checks the platform side):
- In-place git commands: one `gitForm` prints `git -C <appRoot>` relative to the project root wherever cw names a git command (brief, `cw context`, `commit msg`, `commit lint` and `prove` fixes, `git foreign-commits`, the SubagentStart context and the push of `cw pr command`). `cw context` reports `projectRoot` and, when its cwd is another directory, a note that the printed form is relative to the project root. `cw init` writes `Bash(git -C <appRoot> add *)` and `Bash(git -C <appRoot> commit *)` for every appRoot that needs no shell quoting and warns otherwise.
- In worktree mode the reviewer, which runs without isolation in the project root, reads the implementer's worktree with `git -C <relative worktree> …`; the implementer keeps plain `git` in its own worktree.
- `cw commit msg --trailer "<Key: value>"` (repeatable, after the ticket trailer) and `--body-file -` (stdin): agents write nothing under `.git`.
- Acceptance criteria are always testable; a check only a person can do is a manual item of the Definition of done and a `manual` open point (O2, implementer step 3, R3).
- SubagentStart records an implementer only on a task whose complexity matches its `agent_type`; when several tasks wait for the same role, it records nothing and logs the ambiguity. `cw task review` frees `agents.reviewer` whenever it prints an Agent call (first review, `--new-agent`, a stale reviewer, a re-review), so the new reviewer is recorded.
- A rebound confirmed task resumes at O6; the text output of `cw task new --rebind` prints the step too.
- G-ORCH-EDIT denies Edit/Write/NotebookEdit for files of the project (config root, work repo, main checkout), taking the path literally; files outside the project (Claude Code's memory, scratch files) pass (D12; owner decision 2026-10-20).
- Workflow agents may run in the background, and the orchestrator waits for their report either way (ground rule 10); G-AGENT-PARAMS does not check `run_in_background`. Observed in the P3 dry run (CLI 2.1.306, interactive): the Agent tool has no such parameter, a value the orchestrator passes anyway does not reach the PreToolUse hook, and the implementer runs in the background; the orchestrator recorded its id, waited, and read the report after the hand-back message. A headless spike on the same version accepted the boolean `false` and ran the agent in the foreground. A guard check for `false` refused every workflow agent in the interactive CLI.
- Text for `cw` (ticket snapshot, spec, PR/MR body, report, review) goes through a file in the session's scratchpad directory: the Write tool writes it, `cw <command> --task <id> < <file>` reads it; a quoted heredoc is the fallback without a scratchpad. The reviewer may Write, and G-REVIEWER-WRITE refuses every target inside the project (owner decision 2026-10-21). Observed in the P3 dry run (CLI 2.1.306, asking mode): every heredoc with JSON to `cw` asked ("Contains brace with quote character (expansion obfuscation)"), also under `Bash(cw *)`; a Write into the scratchpad and `cw version < <scratchpad file>` ran without a prompt, in the main session and in a subagent, which named the same scratchpad.
- G-CD refuses a `cd` that stays, for the orchestrating session and the workflow agents (owner decision 2026-10-21). Observed in the P3 dry run: the implementer ran `cd <src dir> && sed -i …`, and Claude Code kept the session's cwd after a `cd` (CLI 2.1.306).
- A sandbox refusal to delete a worktree's record in `.git/worktrees` is a precondition (exit 3) with a fix, not an internal error, and `cw task cleanup` prunes the record of a worktree whose directory is gone. Observed in the P3 dry run (CLI 2.1.308, worktree mode): `git worktree remove` under the sandbox deleted the directory and then failed with "failed to delete '.git/worktrees/<name>': Operation not permitted"; the retry outside the sandbox left a prunable record.
- The reviewer's brief names only the relative `git -C .claude/worktrees/<agent> …` form for git in worktree mode, and the absolute path only for the Read tool: the reviewer had run git with the absolute path, which no allow rule matches.
- `cw playbook read steps/<file>|reference/<file>` prints a file of the ticket skill; the skill names its files that way (owner decision 2026-10-21). Observed in the P3 dry run: a Read of the step and reference directories asked once per directory ("Yes, allow reading from … during this session").
- The orchestrator, the implementer and the reviewer write every command plainly, with literal ids and paths: no shell variables, loops, `$(…)` or env prefixes, and no `head`/`tail` on `cw` output; files change only through Edit and Write. Observed in the P3 dry run (CLI 2.1.306, asking mode): Claude Code asks before every command with a variable it cannot check ("A variable in this command can't be checked before it runs"), and agents had cut `cw report show` to its first lines and changed files with `cd` and `sed -i`.
- The orchestrator asks explicitly before a new dependency goes into the spec, also for a library the ticket names; an approved dependency is installed by the user in the work tree after the implementer reports `blocked` (O2, O7).
- Hooks give up after a 10 s self-limit and exit 0 (fail open); SubagentStop also blocks when a present `last_assistant_message` carries a JSON status that differs from the saved file.

**Task state**, under `.git/dev-workflow/`:
- `state.json`: the index for the mod.
- `state.lock`, `doctor-cache.json`, `hooks.log` (D11), `hooks-cache.json` (config and pack guards, cached by mtime), and `checks/` (logs of `cw checks` without `--task`).
- `tasks/<id>/`: `task.json`, `spec.md`, `ticket.json`, `brief-*.md`, `classify.json`, `checks-*.json` + `checks-<stamp>/` logs, `proofs.json` + `proofs.lock`, `report-<n>.json`, `review-<n>.json` (a superseded approval as `review-<n>-r<m>.json`), `commit-msg.txt`, `pr-body.md`.
- Task id = branch with `/` → `__`.
- Locks use O_EXCL with an atomic write-then-rename. Read-modify-write happens under the lock (a fix over the predecessor).

**`prove`:**
- `git worktree add --detach <tmp> HEAD` in the work repo.
- A control run of the single test in the temporary tree at HEAD: it must pass there, otherwise the test depends on ignored or untracked inputs (exit 3, nothing recorded).
- Restore the `--change` files from the base commit (no hooks). A git read error is an error, not a deletion.
- Refuse the test file itself in `--change`.
- Symlink `node_modules` directories from the work tree.
- Run the single-test command: it must fail. Then run in the work tree: it must pass.
- Record the result and remove the temp worktree.
- Known limitation: cross-workspace imports resolve through `node_modules` symlinks to the original tree. Document this and flag such proofs.

**`checks`:**
- Changed files: `git diff --name-only <base>...HEAD` ∪ porcelain status, in the work repo.
- Map them to packages. Run each package's checks in order with a timeout and logs.
- **No package selected while files changed is an error, not a pass.**

**`init --interactive`:**
- Detects npm workspaces, packages, areas (react → frontend, express → backend), check scripts, `appRoot` (a nested git repo next to `.claude/`), variants from dependency majors, and options (`moduleResolution` from tsconfig, `vitestGlobals`).
- Asks the open questions in the terminal.
- Writes the config, compiles the rules, and merges `.claude/settings.json` (§12).
- Adds the CLAUDE.md section and `scripts/setup-dev-workflow.sh`.

## 9. Hooks and guards (`plugins/dev-workflow/hooks/hooks.json`, exec form `node` + `args`)

- **SessionStart** (`startup|resume`). No-op without config; no network. Checks:
  - config valid, packs resolve, rules drift (hashes);
  - Node ≥ 20, git ≥ 2.31, the work repo and the state dir; the `claude` version only in `cw doctor` (the quick check of the hook skips spawning `claude`);
  - `gh` or `glab` binary present for the work repo's host;
  - the way to the tickets of `tickets.source` (warning): atlassian enabled, a Linear server in `.mcp.json`, or the folder of the local ticket files;
  - on macOS, `allowLocalBinding` in user settings (warning).
  - Output: a one-line `systemMessage` plus facts in `additionalContext`; nothing when every check passes.
- **SubagentStart** (`^dev-workflow:`). Role context ≤ 6,000 chars: work tree and mode, packages with checks, a guards summary, "your brief file is named in your prompt". Records `agent_id`, role, start time and session in `task.json` (the input carries `agent_id` and `agent_type`); an implementer only on a task whose complexity matches its `agent_type`, and nothing when several tasks wait.
- **SubagentStop** (`^dev-workflow:(implementer-(s|m|l|xl)|reviewer)$`). Checks the current round's `report-<n>.json` / `review-<n>.json`: present, valid, and written after the start that SubagentStart recorded for this `agent_id`. On failure: `decision: "block"`, with a reason that names the command to run. At most 2 blocks per agent_id (counter in `task.json`). `last_assistant_message` is only a cross-check when present: the CLI fills it, also after a block, but in the Desktop app a `SubagentHandback` report leaves it out (S7).
- **PreToolUse** (`Bash|Agent|Edit|Write|NotebookEdit`), deny-only with reason and alternative:

| ID | Applies to | Denies |
|---|---|---|
| G-ORCH-EDIT | the main session that owns an active task | Edit/Write/NotebookEdit of project files (the path taken literally) |
| G-CD | the main session that owns an active task, workflow subagents | a `cd`/`pushd` that stays, outside a `( … )` subshell, `$(…)` or `bash -c` script: the cwd persists between Bash calls and breaks the printed git forms |
| G-AGENT-PARAMS | everyone | `model`/`effort` on Agent calls; in worktree mode, an implementer call without `isolation: "worktree"` |
| G-PUSH | workflow subagents | `git push`, `gh pr create/merge`, `glab mr create/merge` |
| G-FORCE | everyone | `git push --force`, `-f`, `--force-with-lease` |
| G-REVIEWER-WRITE | reviewer | git write subcommands, `git config` with a value, `git remote add/remove/rename/set-url`; redirection/`tee`/`sed -i`/`find -delete`/`git --output` and file commands (`cp` destination, `mv`, `rm`, `touch`, …) into the repo; Edit, NotebookEdit, and Write into the project |
| G-DEPS | workflow subagents | `npm install/i/ci/uninstall/update`, `npm audit fix` and their npm aliases (pack-contributed) |
| G-COMMANDS | workflow subagents | the config's `guards.commands` |
| G-PORTS | workflow subagents | the config's `guards.ports`, when a command binds or contacts one (grep, rg, cat, sed, echo, printf, cw and git outside its network subcommands only mention it) |
| G-DEVSERVER | workflow subagents | dev servers when `guards.devServer = never` |

  - Parser: segments split on `&& || ; |` and newlines, outside quotes. Command substitutions `$(…)` and backticks are parsed recursively, **also inside double quotes**, and so are `bash -c` / `sh -c` strings. The wrappers `env`, `command`, `exec`, `nohup`, `timeout`, `sudo` (also `time`, `nice`, `xargs`, `builtin`) are stripped. `/usr/bin/git` is normalized to `git`. A source argument of `cp` doesn't count as a write. Decided in P3: `eval` and a shell fed a heredoc or here-string are parsed too; unquoted heredoc bodies and `${…}` words are searched for `$(…)` and backticks, quoted heredocs stay data; a `+refspec` push counts as a force push.
  - The role comes from `agent_type` (`dev-workflow:implementer-m`, `dev-workflow:reviewer`; absent in the main session). A main-session event has no `agent_id`; G-ORCH-EDIT applies when its `session_id` owns an active task (D3). A hook deny also applies in `bypassPermissions` (S7).

## 10. Git conventions

**Preset `default`** (`plugins/dev-workflow/presets/git/default.json`):
- Branch `{ticket}/{type}/{slug}`, with `type` ∈ feature|bugfix|hotfix and a slug of 2–4 lowercase words joined by hyphens.
- `noTicketKey`: default `maintenance`; a project may override it, e.g. to `NO-TICKET`.
- Commit summary `[KEYWORD] Summary`, keywords `[FEATURE] [BUGFIX] [TASK] [DOCS]`, flags `[!!!] [SECURITY]` before the keyword.
- Hard limit 72, ideal 52; body wrapped at 72 (lists, URLs and code exempt).
- Trailer `Relates to {ticket}`, left out for the no-ticket key.
- PR/MR title follows the summary rules. Sections: "What & why", "Testing" (only what was actually verified), "Risks & deploy steps", "Open points" (unfixed non-blocking findings and the report's open points). Empty sections are left out. Never merge.

**Preset `ticket-suffix`** (`presets/git/ticket-suffix.json`, owner decision 2026-10-23 for fisko): branch `{ticketLower}-{slug}`, `chore-{slug}` without a ticket; summary `{text} ({ticket})` without keywords, flags or trailers; PR/MR title = the oldest commit's summary; sections "What & why", "Affected packages", "Testing", "Risks & deploy steps", "Open points", "Screenshots".

**This repo's own conventions** (write them into its CLAUDE.md):
- English; the conventions above with `NO-TICKET`.
- Per-plugin semver in `plugin.json`; CHANGELOG in Keep a Changelog format; after a merge, `claude plugin tag --push` per changed plugin (tags `<plugin>--v<version>`).
- Private GitHub marketplace (`remklov/claude-tools`, cloned over SSH); no npm dependencies; hooks fail open except the deliberate denies and blocks.
- Never rename a plugin after its first release.

## 11. `agents-progress` (mod)

- **Start from** the earlier project's copy of the mod. Name it `agents-progress`; command `/agents-progress`. Keep the README's MIT attribution to savvy-progress.
- **State source:**
  - At `session.start`, walk up from `$.session.cwd()` to `.claude/dev-workflow/config.json` with `$.fs.exists` (`$.fs.ancestors` only reads `.md` files, per the bundled types); then `$.process.run(['git', '-C', <root>, 'rev-parse', '--path-format=absolute', '--git-common-dir'])`; then read `state.json` (S5).
  - Every 1 s: `$.fs.exists`, then `$.fs.stat` (it rejects a missing file, S5); re-read only when `mtimeMs` changed. Also re-read right after a Bash tool call whose command starts with `cw ` (`tool.call` with `{ tool: 'Bash' }` gives `e.command`).
  - Invalid JSON → keep the last good state. A missing file → only the generic agents pane.
- **No network and no git fetch.**
- **Roles:** parse `dev-workflow:(implementer-(s|m|l|xl)|reviewer)`.

  | Agent | Costume |
  |---|---|
  | implementer, by task area | frontend painter, backend chef, infra engineer; mixed or none → plain with tier badge |
  | reviewer | detective |
  | Explore | pirate |
  | anything else | plain |

  - Tier colours and badges stay. The terminal shows the badge only.
- **Band:** one line per active task: ticket · title · phase · `Round n/3` while in review · tier · `step n/8` · PR link (https only). `escalated` in the failure colour; hidden without tasks.
- **Plan B** (S5 fails): keep the `progress` tool. `cw` prints the progress payload at each transition, and the `ticket` playbook calls the tool if it's available, skipping silently otherwise.
- **Tests** with `claude plugin test`: state reader (missing file, invalid JSON, unchanged mtime), role/tier parsing, band lines, agent lifecycle (carried over).

**Decided in P4** (covered by `claude plugin test`, which the `validate` CI job runs):

- No `progress` tool: S5 passed, and `state.json` carries every field the band shows, so Plan B stays unbuilt.
- An implementer's costume follows its task's areas from `state.json`, by the agent id `cw task agent` recorded: exactly one of `frontend`, `backend`, `infra` or `infrastructure`, else plain (the default area `app` too).
- The pane shows the rounds of an agent's task from `state.json`: `Round n` on the implementer's row from round 2, `Round n/m` on the reviewer's row from review round 2.
- The band shows `step n/8` only in the phase `implement` (before it, cw's step marks read 0/8); its link is labelled `PR/MR`; a task leaves the band when it has an outcome (`state.json` keeps ended tasks for ten minutes).
- Checked with Claude Code 2.1.308 only (tests, `validate`, type check against its declarations); the recheck of the S5 mod APIs on 2.1.296 is open.

## 12. `setup.sh` (repo root; bash, shellcheck-clean, macOS + Linux)

**Entry points:**
- `git clone --depth 1 <ssh-url> /tmp/dw && /tmp/dw/setup.sh`, run in the project root (or `--project <dir>`).
- In configured projects, the committed bootstrap `scripts/setup-dev-workflow.sh` (template in the plugin, about 20 lines: clone into a temp dir with an EXIT trap, then `exec setup.sh --project <root> "$@"`).
- Re-running is the update path.

**Steps** (each: check → explain → act only with consent → verify; idempotent):
1. **Project root** = git toplevel. Refuse inside the marketplace repo itself. Every `claude plugin` call runs with this directory as its cwd: `marketplace add --scope project` writes `<cwd>/.claude/settings.json`, also from a subdirectory (S6).
2. **Prerequisites:** git, Node ≥ 20, `claude` ≥ the minimum version (print the upgrade hint).
3. **SSH:** `ssh -T -o BatchMode=yes git@github.com`. GitHub answers a working key with exit 1 and "successfully authenticated"; that counts as success. If it fails, guide through `ssh-add --apple-use-keychain <key>`, a `~/.ssh/config` block (`AddKeysToAgent yes`, `UseKeychain yes`) and `known_hosts`. Claude Code runs git without prompts and doesn't read a token.
4. **Marketplace:**
   - Snapshot `.claude/settings.json` first. The first `marketplace add` and the first project-scope `install` rewrite it with reordered, reformatted keys plus the new keys; re-runs and local-scope installs leave it byte-identical (S6). setup.sh accepts this one-time rewrite (owner decision at the P0 check-in) and lists the file under the files to commit.
   - Use `--json` where the command has it (`marketplace add`, `install`, `update`): the last stdout line is `{ command, outcome, message, … }` (documented; S6 saw it for `install`).
   - `claude plugin marketplace list --json`: if `remklov` is registered from another source (e.g. a local `directory`), warn and offer to remove it (S6: such a source replaces the git one with only a notice, and installed plugins then report "not found in marketplace" in `plugin list --json` `errors`).
   - `claude plugin marketplace add remklov/claude-tools --scope project` (a github source, which Claude Code clones over SSH), then `claude plugin marketplace update remklov`. A git source with the SSH URL counts as the same marketplace.
5. **Plugins:**
   - Required for the Desktop app too: it shows no trust dialog and ignores a committed `extraKnownMarketplaces` in an untrusted repo, but loads the plugins once `marketplace add` and `install` ran (Desktop 2.1.299, S2/S5).
   - `claude plugin install dev-workflow@remklov --scope project`, then `claude plugin update … --scope project`.
   - Ask "Install the agents progress display for you in this project? [y/N]" → `--scope local`.
   - If the result is JSON-equal to the snapshot (step 4) but reordered, restore the original bytes.
6. **Git host:** from the work repo's `origin` (`appRoot` from the config, or the detected nested repo).
   - github.com → `gh` installed? `gh auth status --hostname github.com`, else `gh auth login --hostname github.com` (interactive).
   - Other GitLab hosts → `glab auth status --hostname <host>`, else `glab auth login --hostname <host>`.
   - Install hints, e.g. `brew install gh` / `brew install glab`.
7. **Tickets**, by `tickets.source` of an existing config (else `local`): `jira`: Atlassian's `atlassian` plugin enabled? (`claude plugin list --json`). If not, name `claude plugin install atlassian@claude-plugins-official --scope project`, and remind of the one-time `/mcp` login inside Claude Code. `linear`: a Linear server in `.mcp.json`? If not, name `claude mcp add --transport http --scope project linear https://mcp.linear.app/mcp/readonly` and the commit of `.mcp.json`. `local`: nothing to connect.
8. **macOS:** `sandbox.network.allowLocalBinding` in `~/.claude/settings.json`. Explain that it applies to all projects; set it with consent via a Node JSON merge that keeps all other keys.
9. **No config yet:** `cw init --interactive`, run through `node <clone>/plugins/dev-workflow/bin/cw`. List the files to commit.
10. **Finish:** `cw rules build --check` (offer a rebuild on drift); `cw doctor --fresh`; then "Open Claude Code in <project>, trust the folder, run `/dev-workflow:ticket <KEY>`".

**Flags:** `--project <dir>`, `--yes` (accept defaults; progress stays off unless `--with-progress`), `--with-progress`, `--no-progress`, `--check` (report only), `--skip-plugins` (tests).

**Robustness:** never `| head -1` under pipefail without `|| true` (SIGPIPE, Appendix B). Never touch CLAUDE.md outside the dev-workflow markers.

**Tests:** `tests/setup.test.sh`, with stub `claude`/`gh`/`glab`/`ssh` on PATH. Cases: fresh run; re-run; declined consent; SSH failure; `gh`/`glab` missing or not logged in; a same-name directory marketplace; settings-reorder restore; `--yes` without progress.

**Decided in P5** (`tests/setup.test.sh`, 43 checks, in the `setup` CI job):

- Answers come from stdin, one line per question: typed in a terminal, piped in tests. No line at all counts as no, so a run without input changes nothing; `--yes` takes each default.
- setup.sh refuses inside Claude Code (`CLAUDECODE=1`), like `cw init --write`.
- A failed SSH check stops the run before the marketplace (it would fail over SSH anyway), except with `--check` or `--skip-plugins`.
- A same-name marketplace of another source is removed only on an explicit yes (default no): from its last scope, a remove uninstalls its plugins.
- The `gh`/`glab` login runs only in a terminal and without `--yes`; otherwise setup.sh names the command.
- `--check` exits 1 when a step has an open point.
- The commands follow the plugin commands reference (code.claude.com/docs/en/plugins/cli-reference): `--json` result lines on `marketplace add|update` and `install|update` (Claude Code 2.1.287 or later, below the minimum 2.1.296), `marketplace list --json` and `plugin list --json` for the checks.

**Settings merge** by `cw init` (additive; existing scalars kept and conflicts reported; arrays unioned; `settings.local.json` never touched):
- allow: `Bash(cw *)`, `Bash(git add *)`, `Bash(git commit *)`, and each plain check command; in in-place mode also `Bash(git -C <appRoot> add *)` and `Bash(git -C <appRoot> commit *)` from the config, because `Bash(git add *)` does not match the `git -C …` form (code.claude.com/docs/en/permissions), and the read-only `git -C <appRoot> status|diff|log|show|ls-files|rev-parse *` and `git -C <appRoot> branch --show-current`, because Claude Code runs read-only git without a prompt only in the plain form; in worktree mode the same read-only commands as `git -C .claude/worktrees/* …` for the reviewer (owner decision 2026-10-21). Owner decision 2026-10-20, implemented in P3: `cw` prints the in-place git commands as `git -C <appRoot> …` relative to the project root.
- ask: `Bash(git push *)`, `Bash(git -C * push *)` (the form `cw pr command` prints; `Bash(git push *)` does not match `git -C … push`, code.claude.com/docs/en/permissions), `Bash(gh pr create *)`, `Bash(glab mr create *)`, `Bash(npm ci *)`, `Bash(npm install *)`, `Bash(npm i *)`, `Bash(npm uninstall *)`, and the npm aliases of install, ci, uninstall, install-test and install-ci-test (`npm add`, `npm rm`, `npm it`, …; from `npm <command> --help`, npm 11.6.2).
- The allow, ask and deny entries come only from the active packs' `settings` (decided in P2): `core` carries the git, PR/MR and Agent entries, `node-npm` the npm entries.
- deny: `Agent(model:*)`, `Agent(effort:*)`.
- `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "1"` (S9).
- Worktree mode: `worktree.baseRef = "head"` and `worktree.symlinkDirectories`.

## 13. Repository structure

```text
claude-tools/
├── .claude-plugin/marketplace.json     # name remklov, owner Benedikt Volkmer; plugins by ./ path
├── setup.sh
├── plugins/
│   ├── dev-workflow/
│   │   ├── .claude-plugin/plugin.json
│   │   ├── bin/cw                      # shim → ../cli/cw.mjs
│   │   ├── cli/                        # cw.mjs, commands/, lib/ (workspace, config, packs, rules, task, spec,
│   │   │                               #   classify, brief, checks, commit, prove, report, host/{github,gitlab},
│   │   │                               #   ticket, doctor, init, glob, fsx, proc, git, out, args)
│   │   ├── agents/                     # implementer-{s,m,l,xl}.md (generated), reviewer.md
│   │   ├── skills/{ticket,implementer-playbook,reviewer-playbook,status,doctor}/
│   │   ├── hooks/                      # hooks.json, session-start.mjs, subagent-start.mjs, subagent-stop.mjs, guard.mjs, lib/
│   │   ├── packs/{core,node-npm,typescript,express,react-vite,vitest}/
│   │   ├── presets/git/default.json
│   │   ├── schemas/                    # config, pack, dev-report, review (documentation + validator)
│   │   ├── templates/                  # claude-md-section.md, setup-dev-workflow.sh, settings fragments
│   │   ├── tools/                      # generate-agents.mjs (--check), repo-lint.mjs (budgets, private terms, schemas)
│   │   └── tests/                      # unit/, integration/, fixtures/ (temp repos created per test, cleaned with t.after)
│   └── agents-progress/                # .claude-plugin/plugin.json (types), hooks/{hooks.json,register.tsx,state.ts,avatars.ts}, types/, tests/, README.md
├── tests/setup.test.sh
├── tests/dry-run/                      # make-project.mjs + test: the P3 dry-run kit (docs/dry-run.md)
├── docs/                               # PLAN.md, architecture.md, playbooks.md, packs.md, config.md, extending.md,
│                                       #   setup.md, dry-run.md, migration/cq-rules.md, adr/
├── .github/workflows/ci.yml            # Node 20/22: node --test, generator --check, repo-lint (private list), setup tests,
│                                       #   shellcheck, claude plugin validate --strict (marketplace + both plugins), claude plugin test
├── tools/                              # prepush.sh, install-hooks.sh (commit-msg and pre-push hooks)
├── CLAUDE.md · README.md (quickstart ≤ 15 lines) · CHANGELOG.md · LICENSE
```

## 14. Phases, spikes and acceptance

**P0 Spikes** on this Mac (Claude Code CLI and the Desktop app; record each surface's version). Use a throwaway plugin loaded with `--plugin-dir` and throwaway repos in the gitignored `.spikes/` folder of this repo; never commit them. Each spike has a plan B; the results are in Appendix D:

| Spike | Question | Plan B |
|---|---|---|
| S1 | A plugin agent with `skills: [<plugin>:<skill>]` gets the full skill text (it quotes a token without reading files) | The generator inlines SKILL.md into the agent body |
| S2 | `cw` from the plugin's `bin/` is on PATH in the main session and in subagents, in CLI and Desktop | Skills and briefs call `node "${CLAUDE_PLUGIN_ROOT}/cli/cw.mjs"` (substituted in plugin skills) or an absolute path |
| S3 | Does `CLAUDE_CODE_SESSION_ID` reach Bash commands, and does it equal PreToolUse's `session_id`? | The guard records the session ↔ task binding when it sees `cw task new` |
| S4 | An Agent call with `isolation: "worktree"` for a plugin agent without frontmatter isolation creates a worktree; `worktree.baseRef: head` and `symlinkDirectories` take effect | Generate worktree variants of the implementer agents |
| S5 | `$.fs.stat`/`$.fs.read`/`$.process.run` work in the mod on the installed version; the band updates on a state change | The `progress` tool fed by `cw` |
| S6 | The exact JSON written by `marketplace add --scope project` and `plugin install --scope project\|local`; project-root resolution from a subdirectory; idempotent re-runs; any extra user-level declaration; settings reordering | Feed the findings into setup.sh |
| S7 | PreToolUse input in the main session (no `agent_type`) vs. subagents (`dev-workflow:…`); a deny blocks Edit in the main session; SubagentStop block behaviour | Adjust the guard design |
| S8 | With the sandbox on: can `cw`, via the Bash tool, write `.git/dev-workflow/`, `.claude/rules/dev-workflow/` and `.claude/settings.json`? | State in `.claude/dev-workflow/state/` (gitignored) or `$TMPDIR` keyed by repo; rules and settings written only by setup.sh in the terminal |
| S9 | Project settings may set `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` | Document it as a user setting |
| S10 | atlassian: the exact tool names and the minimal calls to read an issue (cloudId discovery) | The user pastes the ticket |
| S11 | Linear (read-only endpoint, added 2026-10-23): the exact tool name, its parameters and the response of one issue read | The user pastes the ticket |

Then **check in with the owner** (§0).

| Phase | Content | Done when |
|---|---|---|
| P1 Skeleton | marketplace.json, both plugin.json, CLAUDE.md, README, CHANGELOG, `.github/workflows/ci.yml`, generator, repo-lint | `claude plugin validate --strict` passes for the marketplace and both plugins; generator `--check` and repo-lint pass |
| P2 `cw` core | Everything in §8 with unit tests per module | Integration tests in temp fixtures pass for: in-place (outer repo + nested app repo) and worktree (single repo); a bare remote; stub `gh`/`glab`. Covered: the full task lifecycle to `pr command`; a rebind to a new session (D3); checks pass/fail and "no package selected" = error; `prove` fails on git errors; independence from the cwd; host detection; rules build/drift/applicable; readable config errors. Tests pass on macOS locally and on Linux in CI |
| P3 Workflow | Agents, the three playbooks, procedures, hooks | stdin fixture tests for every hook; every guard with a positive case, a negative case and the bypass forms of §9. Manual dry run in `docs/dry-run.md`: a mini project with Acme Shop's layout (outer repo + `app/`, npm workspaces with tiny React 19/Vite and Express 5/TS/Vitest/ESLint packages, a local bare "origin"); `/dev-workflow:ticket NO-TICKET <task>` runs an S task end to end; the PR command is printed for gh (and glab in a GitLab variant); `app/` is back on base afterwards; Edit/Write refused in the main session during the task and allowed after `cw task end`; a session without the command behaves normally. The same in worktree mode. `/clear` during a task, then the command again: the task is rebound after confirmation and G-ORCH-EDIT applies in the new session. A blocked → SendMessage → new report round and a second review round (`cw review show` prints `Review round 2/3` after changes were requested; a spec change starts a new cycle at round 1), in the CLI and in the Desktop app, including one SubagentStop block there. Once in the Desktop app in auto mode (Desktop 2.1.299 refused spike calls whose instructions came from another session; Appendix D) |
| P4 Display | `agents-progress` | `claude plugin test` passes; manual check in terminal (wide and narrow) and Desktop |
| P5 Installer | setup.sh, its tests, docs | `tests/setup.test.sh` passes; README quickstart; docs complete |
| P6 Migration | Consumer projects (fisko first), outside this run | Appendix C |

**v1 overall:** CI green; neither plugin is installed without consent; the earlier marketplace is untouched; every CQ-1…23 has a successor rule; repo-lint finds neither the built-in private term (savvy) nor a term of the private list (`FORBIDDEN_TERMS`), in files, paths, commit messages and commit authors.

## 15. Later (not v1)

The investigator role (Opus 5.5, xhigh effort); Docker / GitHub Actions / GitLab CI packs; builds-on sub-task chains; a base-moved check; the PR/MR link as a Jira comment; more stacks (PHP/TYPO3, Python) as packs; per-project model-matrix overrides.

## Appendix A: verified platform facts (2026-10-19; Claude Code 2.1.296 unless an entry names another version)

From code.claude.com/docs (plugins/*, skills, sub-agents, hooks, settings-reference, memory, plugins/mods/*) and local CLI help:

- **Plugin layout:** `skills/`, `agents/`, `hooks/hooks.json`, `bin/` (on the Bash tool's PATH while enabled, after the user's own PATH), and a root `settings.json` (only `agent` and `subagentStatusLine` take effect; `agent` makes every session that agent unless the user's own settings set `agent`).
- **Plugins can't ship `.claude/rules` or a CLAUDE.md.**
- **Skills:**
  - Invoked as `/plugin:skill`; `disable-model-invocation`, `user-invocable`.
  - `allowed-tools` only pre-approves; `disallowed-tools` removes tools while the skill is active (until the next user message).
  - `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` are substituted in plugin skills; `${CLAUDE_PLUGIN_ROOT}` also in agent bodies (S1) and command bodies (documented).
  - A plugin agent's `skills:` accepts `plugin:skill` and the bare name; a skill with `disable-model-invocation: true` is not preloaded (S1, also documented).
- **Plugin agents:**
  - Supported fields: `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills` (full content injected, up to 32), `memory`, `background`, `isolation` (only `"worktree"`), `color`, `autoCompactWindow`, `omitClaudeMd`, `experimental.cacheTtl`.
  - Ignored: `permissionMode`, `hooks`, `mcpServers`, `initialPrompt`.
  - Name: `<plugin>:<name>`.
  - `Agent(model:*)` doesn't match a call without `model`.
- **Hooks:**
  - Exec form when `args` is set. `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` and `CLAUDE_PROJECT_DIR` are in the hook env, **not** in Bash tool commands.
  - `agent_type` is present inside subagents (the scoped name).
  - SubagentStop `decision: "block"` keeps the subagent running with `reason`.
  - PreToolUse `permissionDecision: "deny"`.
  - `additionalContext` works for SessionStart, SubagentStart and UserPromptSubmit; each string is capped at 10,000 characters (documented), and a 7,000-character SubagentStart context arrived whole (S7).
  - A plugin SessionStart hook can append `export` lines to `CLAUDE_ENV_FILE`; later Bash commands of the main session and of subagents see them (S2, headless CLI).
  - `CLAUDE_CODE_SESSION_ID` is in the Bash env of the main session and of subagents and equals the hook input's `session_id` (S3). Main-session hook input has no `agent_id`/`agent_type` (S7).
  - A PreToolUse deny also applies in `bypassPermissions` (S7). PreToolUse sees the Agent call's `isolation`, `model`, `effort` and `run_in_background` in `tool_input`; where the Agent tool has no `run_in_background` (interactive CLI 2.1.306), a value the model passes anyway does not reach `tool_input` (observed, P3 dry run).
  - Read during P3 (hooks page): SubagentStart also runs when Claude resumes a subagent; `claude --debug-file <path>` logs each hook run with its duration. The dry run checks both.
- **Protected paths** (permission-modes page, read during P3): writes under `.git` and `.claude` are prompted in default and acceptEdits mode, go to the classifier in auto mode and are denied in dontAsk mode; `permissions.allow` rules do not pre-approve them. Agents therefore write no file there (§6 implementer step 6).
- **Marketplace sources:** `marketplace add` takes `owner/repo`, a git URL (`user@host:path[.git]`, https `….git`), an https URL of a `marketplace.json`, or a local directory or `.json` path (documented); a `file://` URL is refused with "Invalid marketplace source format" (S6). `./` relative and `git-subdir` are plugin-entry sources inside `marketplace.json`.
  - `plugin.json` `version` wins; without one, git sources use the commit SHA.
  - An unbumped pinned version means no update.
- **Installs:**
  - Automatic installs: managed `enabledPlugins`; a declared `dependencies` entry (installed at `install`, `marketplace add`, `/reload-plugins` and auto-update; S6 saw a declared dependency installed into local scope); enabled but uncached plugins from user, managed or `--settings` sources at session start; claude.ai-synced plugins (documented).
  - A committed `enabledPlugins` doesn't install anything. After the trust dialog Claude Code clones a committed `extraKnownMarketplaces` entry, and its relative-path plugins load without an install (documented).
  - `marketplace add --scope project` declares the marketplace in project settings. `install --scope user|project|local` (default user).
  - Exact writes (S6): `extraKnownMarketplaces.<name>.source = { "source": "git", "url": "git@…" }` in `<cwd>/.claude/settings.json`; `install` adds `enabledPlugins["<plugin>@<marketplace>"]: true` to `.claude/settings.json` (project) or `.claude/settings.local.json` (local). User-level state: `~/.claude/plugins/known_marketplaces.json`, `installed_plugins.json`, the clone in `plugins/marketplaces/<name>`, the cache and `~/.claude.json`; project- and local-scope commands don't touch `~/.claude/settings.json`.
  - `install --marketplace` declares the marketplace in user settings even with `--scope project`, so don't use it.
  - Re-runs: "already on disk" / "already installed", exit 0.
  - `claude plugin tag [path]` creates the git tag `{name}--v{version}` after checking that `plugin.json` and the marketplace entry agree; `--push` pushes it to `--remote` (default `origin`), and it refuses a dirty working tree unless `--force` (documented; help and `--dry-run` observed on CLI 2.1.303).
- **Private git:** git runs without prompts. SSH needs a key usable without a passphrase prompt (ssh-agent/Keychain) and the host in known_hosts. Tokens in the environment alone don't authenticate. Auto-update is off for third-party marketplaces unless `autoUpdate: true` is set on the `extraKnownMarketplaces` entry (or the user's `known_marketplaces.json` record); `marketplace.json` has no such field (documented).
- **Mods:** documented (plugins/mods/*): `hooks.json` `{ "modules": [...] }`, `$.tool`, `$.ui`, `$.fs`, `$.process`, `$.clock`. Terminal ≥ 2.1.287, Desktop ≥ 2.1.286. The Code tab is supported. Observed (S5, CLI 2.1.303 and Desktop 2.1.299): `$.session.cwd()`, `$.process.run(argv)` → `{ exitCode, stdout, stderr }`, `$.fs.exists`, `$.fs.stat` (rejects a missing file) and `$.fs.read` work, and the band follows a file within the 1 s poll. `plugin.json` needs `types` naming the `PluginState` keys, and `claude plugin validate --strict` needs `author`.
- **Agent tool:** accepts `isolation: "worktree"` per call (observed in a Desktop session's tool schema, 2.1.296). Main-session calls without `run_in_background` ran in the background, a nested call from a subagent in the foreground (headless CLI 2.1.296 and 2.1.303). The Agent tool of the interactive CLI 2.1.306 has no `run_in_background` and says that subagents run in the background and notify on completion (observed in the session's tool schema, P3 dry run); a Desktop session's Agent tool says the same (2026-10-21). `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` defaults to 3 (documented); `"1"` in a trusted project's `env` removed the Agent tool from subagents (S9).
- **Sandbox (S8, CLI 2.1.296 and 2.1.303; the sandboxing page, read during P3, adds: `/sandbox` saves its mode to the project's `.claude/settings.local.json`, adds that file to the global gitignore, and command hooks run outside the sandbox):** Bash under `sandbox.enabled` may write the working directory including `.git/dev-workflow/` and `.claude/rules/`, and the main `.git` from a linked worktree; the session's own `.claude/settings.json` and `.git/config` are refused with EPERM. A subagent's write to a nested `app/.claude/settings.json` succeeded.
- **The Desktop app (engine 2.1.299, observed):** no trust dialog; a committed `extraKnownMarketplaces` in an untrusted repo is ignored; after `claude plugin marketplace add` and `install` from the CLI the plugins load (hooks, `bin/`, agents, mods) without a trust entry. Subagents hand their report back through `SubagentHandback`, and SubagentStop then has no `last_assistant_message`. The auto-mode classifier judges Bash and Agent calls; it refused calls whose instructions came from another session.
- **CLI help quirk on 2.1.296:** nested `--help` prints the top-level help; use `claude plugin help install` and `claude plugin marketplace help add`.
- **gh 2.102.0:**
  - `gh pr create -B <base> -H <head> -t <title> -F <file>`.
  - `gh pr view <branch> --json url,state`.
  - `gh auth status --hostname github.com` (exit 1 on auth problems; with `--json` always 0); `gh auth login --hostname …`; `gh auth setup-git`.
  - Exit code 4 = requires authentication.
- **glab 1.122.0:**
  - `glab mr create -s <src> -b <target> -t <title> --description-file <file> -y [--draft] [--remove-source-branch]`.
  - Existing MR: `glab mr view <branch> -F json` (fallback `glab mr list --source-branch <b> -F json`).
  - `glab auth status --hostname <host> [-F json]`; `glab auth login --hostname <host>`.
  - The host comes from the remote, or from `-R <url>` / `GITLAB_HOST`.
  - No documented exit codes, so parse JSON.

## Appendix B: installer lessons of the earlier marketplace (from its `install.sh` and docs)

- `marketplace add` on an existing marketplace refreshes nothing → also run `marketplace update`.
- `plugin install` doesn't upgrade → also run `plugin update`.
- A `--scope project` install rewrites `settings.json` with reordered keys → restore it if JSON-equal.
- A user-scope install enables a plugin in every project.
- A local marketplace with the same name hides the git one.
- The install prompt on folder trust can't be relied on (observed on 2.1.220).
- SSH URLs, because the background refresh disables credential helpers.
- `| head -1` under `pipefail` can die of SIGPIPE.
- Never edit CLAUDE.md outside markers.
- Cached plugin versions are never pruned.
- Plugins must never be renamed.

## Appendix C: migration outline for a consumer project (P6, separate PR in the project, outside this run)

**Keep or add:**
- `.claude/settings.json`: marketplace `remklov` (github source `remklov/claude-tools`), `dev-workflow@remklov`, permissions.
- `.claude/dev-workflow/config.json`: in-place with `appRoot` or worktree mode, packs as in §5, preset `default` with the project's no-ticket key, `tickets` (local files by default), project rules.
- `.claude/rules/dev-workflow/`, CLAUDE.md (conventions + the dev-workflow section), README, `scripts/setup-dev-workflow.sh`.

**Remove:**
- Project-local agents (an orchestrator, dev agents, a code reviewer) and their generator.
- The old code-quality rules file (after a CQ mapping like `docs/migration/cq-rules.md`) and setup hooks.
- A vendored progress mod and project-local marketplace entries.

**Each developer** removes `"agent": "orchestrator"` (or `"agent": "dev-workflow:orchestrator"`) from their `.claude/settings.local.json` and runs `scripts/setup-dev-workflow.sh`.

**fisko** runs the predecessor of this repository (worktree mode, `.claude/workflow/profile.json`, the NEXT_STEPS backlog with claim refs, the aliases CQ-1…28). Its migration maps the profile to `config.json`, its backlog rows to local ticket files or another source, and CQ-1…28 to pack and project rules.

**Pilot:** one S, one M and one L ticket per project.

## Appendix D: P0 spike results (2026-10-19)

Surfaces: CLI 2.1.296 (all headless runs, S6) and, after a self-update, CLI 2.1.303 (all headless runs again, S5 in Ghostty); the Desktop app (Code tab; app 2.42304.2, engine 2.1.299: S2, S3, S5, S7, S10). Headless runs: `claude -p --plugin-dir <spike plugin> --output-format stream-json --include-hook-events` in throwaway fixtures that were trusted interactively first, Sonnet 5.5. The spike kit and all raw evidence stay in the gitignored `.spikes/` (`out/<version>/`, `out/desktop-*.md`).

| Spike | Verdict | Evidence | Consequence |
|---|---|---|---|
| S1 | pass | Plugin agents with `skills: [spike:pb-test]` and with `[pb-test]` quoted the skill's marker without reading files; a skill with `disable-model-invocation: true` was not preloaded (`NO-TOKEN`); `${CLAUDE_PLUGIN_ROOT}` arrived substituted in the skill and the agent body. Headless 2.1.296 and 2.1.303; a Desktop 2.1.299 subagent quoted it too | Agents preload `dev-workflow:<role>-playbook`; the agent playbooks are `user-invocable: false` (D4) |
| S2 | pass | Headless 2.1.296 and 2.1.303: `spike-echo` from `bin/` resolved in the main session, a subagent and a worktree subagent; `CLAUDE_PLUGIN_ROOT` is unset in Bash. Desktop 2.1.299: resolved in the main session and a subagent once the plugin was installed via the CLI; with only the committed settings nothing loaded | `bin/cw` as planned; the Desktop app needs the CLI registration of setup.sh (§12 step 5) |
| S3 | pass | Headless: `CLAUDE_CODE_SESSION_ID` in main and subagent Bash equals the hooks' `session_id`. Desktop 2.1.299: main-session Bash = hook `session_id` = transcript id; a subagent's Bash showed the same id (in the build session) | Session binding as in D3 |
| S4 | pass | Per-call `isolation: "worktree"` on a plugin agent without frontmatter isolation created `.claude/worktrees/agent-<id>` on `worktree-agent-<id>`; `baseRef: head` started it at the local `feature-x` tip, a `fresh` control run at `origin/main`; `node_modules` was a symlink. Headless 2.1.296 and 2.1.303 | No worktree agent variants; D5 (branch via `git switch -c`, no `git -C` in worktree agents) |
| S5 | pass | CLI 2.1.303 with `--plugin-dir` (Ghostty): `$.fs.stat` rejected the missing file, then with `$.fs.exists` the band went `waiting · no state file` → `First title · spec · src=poll · reads=1` → `Second title · review · src=poll · reads=2` → parse error on broken JSON. Desktop 2.1.299: `waiting` → `Desktop title · review · src=poll · reads=1`. `claude plugin validate --strict` passes | State-driven band as in §11; the `progress` tool is not needed; P4 rechecks on 2.1.296 |
| S6 | pass | Isolated `HOME`, CLI 2.1.296, the earlier marketplace over SSH: exact JSON in Appendix A; `--scope project` from a subdirectory writes `<cwd>/.claude/settings.json`; re-runs exit 0; the first add and install reorder `settings.json`, re-runs leave it unchanged; a same-name directory marketplace replaces the git source; `file://` is refused (2.1.296 and 2.1.303); a declared dependency was installed automatically | setup.sh changes in §12 steps 1, 4 and 5 |
| S7 | partial: plan B for the SubagentStop message check | Headless 2.1.296 and 2.1.303: main-session PreToolUse has no `agent_id`/`agent_type`, subagent events carry `agent_type: "spike:probe"`; a deny blocked Edit in the main session in `acceptEdits` and `bypassPermissions` while the subagent's Edit passed; a SubagentStop block continued the agent (`stop_hook_active` true on the second call) and `last_assistant_message` held the new answer; `Agent(model:*)` and `Agent(effort:*)` deny rules refused the calls. Desktop 2.1.299: the same hook input (`permission_mode: auto`) and the deny, but the subagent reported through `SubagentHandback` and SubagentStop had no `last_assistant_message` | Guards as in §9; the SubagentStop gate checks the saved report file; reports are read with `cw` (D4) |
| S8 | partial: plan B for settings writes | `sandbox.enabled`, headless 2.1.296 and 2.1.303: writes to `.git/dev-workflow/` and `.claude/rules/dev-workflow/` succeeded (main session, subagent, worktree agent into the main `.git`); the session's own `.claude/settings.json` failed with EPERM, while a subagent's write to a nested `app/.claude/settings.json` succeeded; branch, commit and switch in the nested `app/` worked; `git branch -D` could not update `.git/config` | `cw` never writes `.claude/settings*.json` in a session; no git commands that rewrite `.git/config` (§8) |
| S9 | pass | Without the variable a subagent started a nested agent (default depth 3, documented); `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "1"` in a trusted project's settings removed the Agent tool from the subagent. Headless 2.1.296 and 2.1.303 | Keep the project `env` entry (§12) |
| S10 | pass | Desktop 2.1.299 (build session): `getJiraIssue` with `cloudId: "example.atlassian.net"` returned the issue as `issues.nodes[0]`; `getAccessibleAtlassianResources` lists the site's `id`. Only five fields were requested | One-call intake as in D6; config `tickets.site` |
| S11 | pass | 2026-10-23, CLI 2.1.309: `claude mcp add --transport http linear https://mcp.linear.app/mcp/readonly` (local scope) in a throwaway repo, OAuth login through `/mcp`. The server listed 43 tools, all reads by name (`get_*`, `list_*`, `extract_images`, `search_documentation`). Headless, `mcp__linear__get_issue` (deferred: ToolSearch first) with `{ "id": "APP-110" }` returned one JSON object with `id` (the key), `uuid`, `title`, `description` (Markdown), `status` (the state's name), `labels`, `assignee` (a name), `url` (`https://linear.app/<workspace>/issue/<KEY>/<slug>`) and more | One-call intake as in `skills/ticket/reference/linear.md` (ADR 0009) |

Owner decisions at the check-in (2026-10-19): the task rebind after `/clear` goes into P2/P3 (D3); setup.sh accepts the one-time reorder of `.claude/settings.json` (§12 step 4). After P2 (2026-10-20): in-place git commands use the relative `git -C <appRoot>` form, with matching allow rules written by `cw init` (§12). During P3 (2026-10-20): G-ORCH-EDIT blocks only the project's files (§8 "Decided in P3"). After the automated dry run (2026-10-21): text for `cw` goes through the scratchpad and the reviewer may Write outside the project; `cw init` writes the read-only `git -C` allow rules; guard G-CD; the ticket skill's files through `cw playbook read` (§8 "Decided in P3"). After the worktree run (2026-10-22): `cw git lint` became `cw commit lint`, because the worktree isolation refuses a `cw git …` call (Appendix A, D5).

Further observations: the Desktop app's auto-mode classifier refused spike calls whose instructions came from another session, and an Agent call whose prompt asked for a "token" (P3 covers auto mode); main-session Agent calls ran in the background by default (D4); the Bash cwd persists between calls and a subagent starts in the main session's current cwd (D5); in a worktree-isolated agent the harness refuses `git -C "$(pwd)" …` (D5). During P3 (worktree-isolated build agents, Desktop engine 2.1.299) the harness also refused an env-prefixed `node`, `sed` with a variable path, `S=…; sh $S/…`, `perl -e '… exec @ARGV'` and an interpreter heredoc whose text named git; it allowed `sh <literal path>`, `node --test` spawning git, and `git commit -F <absolute path outside the worktree>`. The implementer playbook therefore runs git and git-running tools without variables, env prefixes or command substitution around them.
