# Spec 02 — `cw` CLI

`cw` is the deterministic half of the workflow. Agents call it for every mechanical step; people call it for setup and inspection.

## 1. Conventions

- **Runtime:** Node ≥ 20, ESM, no npm dependencies, no build step. Entry `plugins/dev-workflow/scripts/cw.mjs`; shim `plugins/dev-workflow/bin/cw` (`#!/usr/bin/env node`, mode 755, imports `../scripts/cw.mjs`).
- **Invocation:** `cw <command> [subcommand] [options]`. `--json` switches to machine output (one JSON document on stdout). `--cwd <dir>` overrides the working directory. `cw help [command]` prints usage.
- **Exit codes:** `0` ok · `1` a check, lint or validation failed (findings printed) · `2` usage error · `3` precondition not met (dirty tree, missing profile, wrong phase) · `4` internal error (stack trace to stderr, short message to stdout).
- **Output:** human mode prints a short summary, then details; every failure names the fix. Never prints secrets: environment values from the profile are masked in logs (`TEST_DATABASE_URL=***`) unless the key is listed in `knownSafeEnv` of the pack.
- **Writes:** only to (a) `<git-common-dir>/dev-workflow/`, (b) `os.tmpdir()/dw-*` scratch copies (removed in `finally`), (c) the repository for `init --write`, `rules build`, `ticket done`/`ticket new-row`, (d) refs under `claims.namespace` and `claims.idNamespace` on the claims remote (§4.7). Nothing else.
- **Discovery:**
  - `repoRoot` = `git rev-parse --show-toplevel` (worktree root inside a worktree).
  - `commonDir` = absolute `git rev-parse --git-common-dir`; `mainCheckout` = its parent when it ends in `.git`.
  - `profile` = `<repoRoot>/.claude/workflow/profile.json`; missing → exit 3 with "run /dev-workflow:setup".
  - `pluginRoot` = two levels above `scripts/cw.mjs` (`import.meta.url`).
  - Packs: `<repoRoot>/.claude/workflow/packs/<id>` first, then `<pluginRoot>/packs/<id>`. A local pack that shadows a plugin pack triggers a doctor warning.
- **Task selection:** commands with `--task <id>` also accept `--task current`, which resolves to the only task in phase `implement`/`review` whose `worktree` contains the cwd, or the only active task; ambiguity → exit 3 listing candidates.
- **Concurrency:** writes to `state.json` and `task.json` take `state.lock` (O_EXCL create, retry 50 ms up to 5 s, stale after 30 s if the pid is gone).
- **Step markers:** implementer commands set `task.steps` automatically (table in 4.6).

## 2. Module layout

```text
scripts/
├── cw.mjs                  # dispatcher: parse argv, route, map errors to exit codes
└── lib/
    ├── args.mjs            # tiny parser: --flag, --key value, --key=value, positional, "--"
    ├── out.mjs             # human/JSON output, masking, colors only on TTY
    ├── proc.mjs            # spawnSync/spawn wrappers with timeout, tail capture, log file
    ├── git.mjs             # rev-parse, status, diff, log, branch, worktree, merge-tree, ls-tree, show
    ├── glob.mjs            # **, *, ?, {a,b}, character classes; dotfiles match; POSIX paths
    ├── yaml-lite.mjs       # YAML subset for GitHub workflow files (block maps/lists, flow lists, scalars, comments)
    ├── schema.mjs          # JSON-schema subset validator (spec 01 intro)
    ├── template.mjs        # {token} and {token|lower} rendering; template → regex for lint
    ├── fsx.mjs             # atomic write, locks, scratch copy (copy minus .git/node_modules, re-link node_modules)
    ├── profile.mjs         # load, defaults, validate, package-of-file, guards merge
    ├── packs.mjs           # resolve, requires, conflicts, variants, options, detect
    ├── rules.mjs           # parse, layer, customize, scope, compile, lock, applicable (spec 03)
    ├── playbook.mjs        # resolve procedures per role, evaluate `when`
    ├── task.mjs            # state machine, task.json/state.json, history
    ├── spec.mjs            # template, lint, parse sections/ACs/paths
    ├── classify.mjs        # packages, areas, min complexity, split, procedures
    ├── brief.mjs           # brief rendering per role
    ├── checks.mjs          # affected packages, services, exclusive locks, runs, results
    ├── prove.mjs           # prove and mutate in scratch copies
    ├── commit.mjs          # message build, wrap, lint
    ├── report.mjs          # dev report, review, investigation: merge, validate, save
    ├── pr.mjs              # base-moved, PR title/body
    ├── doctor.mjs          # core checks, pack doctor scripts, cache, hook output
    ├── init.mjs            # detect, propose, merge settings, gitignore, snippet
    ├── claims.mjs          # claim registry (git-ref, local), intake, gc, ID reservation, merge driver
    └── ticket/
        ├── markdown-table.mjs
        ├── github-issues.mjs
        └── none.mjs
```

Every module has a `tests/unit/<module>.test.mjs` (`node --test`). Fixture repos live in `tests/fixtures/` as directory trees; tests copy them to a temp dir and run `git init` plus a scripted history (`tests/helpers/repo.mjs`).

## 3. Setup and inspection commands

### `cw init`
`cw init --detect [--json]` · `cw init --write --profile <file> [--yes]`

- `--detect`: runs every pack's `detect` against the repository and proposes a profile.
  - Variants: npm dependency ranges decide majors (`express ^4` → `express@4`, `react ^18` → `react-vite@react-18`).
  - Packages: npm workspaces from the root `package.json`, then directories with their own `package.json`/`pyproject.toml`/`composer.json` up to depth 2. Areas come from pack `areas` and directory names (`*-app`, `web`, `frontend` → frontend; `*-api`, `server`, `backend` → backend; `infra`, `.github/workflows`, `docker` → infra).
  - Checks: each active pack's `checkDiscovery` (node-npm maps scripts `typecheck|type-check`, `lint`, `test`, `test:coverage`).
  - Git: `git.host` from `origin`; branch and commit templates are left as questions.
  - Output: proposed profile JSON plus `questions[]` (ticket adapter, git templates, guards, services, never-guess topics). Writes nothing.
- `--write`: requires a profile file. In order:
  1. Validate the profile; refuse on errors.
  2. Write `.claude/workflow/profile.json` (refuse to overwrite unless `--yes`).
  3. Merge into `.claude/settings.json`: `extraKnownMarketplaces.remklov`, `enabledPlugins` (`dev-workflow@remklov`, `agents-progress@remklov`), permissions from core, active packs and check commands (`allow` for each check command as `Bash(<command> *)` if it is a plain `npm run x`/`npm test`), `deny` `Agent(model:*)`, `Agent(effort:*)`, `ask` for push/PR/installs, `worktree.baseRef: "head"`, `worktree.symlinkDirectories` = `isolation.symlink`, `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "1"`. Merge is additive: arrays are unioned, existing scalars kept (conflicts are reported, not overwritten). Prints a diff.
  4. `.gitignore`: if it uses the allowlist style `.claude/*`, add `!.claude/workflow/` after the last `!.claude/` line.
  5. Instruction snippet between `<!-- dev-workflow:start -->` and `<!-- dev-workflow:end -->` in `AGENTS.md` if `CLAUDE.md` is a symlink to it or absent, else `CLAUDE.md` (template `templates/claude-md-snippet.md`).
  6. If the ticket adapter is `markdown-table` and `claims.mergeDriver` is true: add `<file> merge=dw-ticket-table` to `.gitattributes` and set `merge.dw-ticket-table.driver` in the local git config (shared by all worktrees of the clone).
  7. Run `cw rules build`.
  8. Print how to start an orchestrator session (`claude --agent dev-workflow:orchestrator`, or `"agent": "dev-workflow:orchestrator"` in the developer's own `.claude/settings.local.json`, which `cw` never writes).
- Never reads `.claude/settings.local.json` and never copies values from it.

### `cw doctor [--hook] [--json] [--fresh]`
Runs checks; caches the result for 12 h in `doctor-cache.json` (keyed by profile hash, plugin version, `claude --version`); `--fresh` ignores the cache.

| Check | Level |
|---|---|
| `claude --version` ≥ 2.1.300 (skipped if not on PATH) | error |
| Node ≥ 20, git ≥ 2.38 (`merge-tree --write-tree`) | error |
| Profile valid; packs resolve; variants and options valid | error |
| Rulebook up to date (`rules build --check`) | warning |
| Symlink directories exist in the main checkout (fisko OPS-8: `fisko-signer/node_modules`) | warning |
| Services: `check` command exits 0 or `start` exists | warning |
| Host CLI: `gh auth status --hostname github.com` / `glab auth status` | warning |
| macOS: `~/.claude/settings.json` sets `sandbox.network.allowLocalBinding` | warning |
| Conflicting plugins enabled (`savvy-progress`, `savvy-flow`, any other plugin that registers a `progress` tool) — read from user and project settings `enabledPlugins` | warning |
| Claims remote reachable; a test ref can be listed (`git ls-remote <remote> 'refs/claims/*'`) | warning |
| Backlog merge driver registered in the local git config (markdown-table) | warning |
| Every pack `doctor` script | as reported |

`--hook`: prints nothing when everything passes; otherwise SessionStart JSON with a one-line `systemMessage` and facts in `hookSpecificOutput.additionalContext` (spec 06).

### `cw profile show|validate [--json]`
`show` prints the effective profile with defaults and pack-contributed guards; `validate` exits 1 with findings (path, message).

### `cw playbook show <role> [--task <id>] [--json]`
Lists: the role's playbook skill and its step files; procedures for the role from active packs (variant-filtered) and the project, each with `when` and path; with `--task`, marks which procedures apply to the task; scripts the procedures reference; for implementer/reviewer the package check table; guards.

### `cw rules build|check|applicable|show|list`
See spec 03.

## 4. Task commands

### 4.1 Orchestrator side

| Command | Behaviour |
|---|---|
| `cw intake <id> \| --next [--json]` | **The orchestrator's first command for every ticket request** (§4.7): garbage-collects finished claims, acquires the claim atomically, runs the preflight, prints the ticket. Exit 0 = claimed by this session; exit 3 = held by someone else (prints holder, host, phase, since, stale flag) or not available (blocked, owner, dependencies open) |
| `cw preflight [--ticket <id>]` | Host auth (warning); `git -C <main> fetch origin` (warning on failure); main checkout on `git.defaultBase` (error in worktree mode); `git status --porcelain` → dirty files listed; ticket file dirty → error; ticket row missing in `HEAD` → error. JSON: `{ ok, warnings[], errors[], dirty[] }` |
| `cw ticket list [--open]` / `show <id>` | Adapter call (4.5) |
| `cw task new --ticket <id> --slug <slug> --title <t> [--type feature\|bugfix\|chore] [--branch-type <t>] [--builds-on <branch>] [--parent <task>]` | Renders the branch from the template, validates slug, creates the task directory, `task.json` (phase `spec`), `spec.md` from the template with header filled. Prints task id and spec path |
| `cw spec lint --task <id>` | Rules in spec 01 §6. Exit 1 on errors; warnings printed |
| `cw classify --task <id> [--paths <glob>…]` | Collects paths (spec Context backticks + `--paths`), maps to packages (longest prefix), areas, minimum complexity (profile `complexity.escalate` + pack `complexity`; keyword match whole-word, case-insensitive, on title + requirements), split recommendation (packages from ≥ 2 entries of `split.order` and min ≥ `split.threshold`), applicable procedures per role. Writes `classify.json`; phase → `classify` |
| `cw classify --task <id> --set <c> --why "<one sentence>" [--override "<reason>"]` | Stores the chosen complexity; below minimum only with `--override` |
| `cw task confirm --task <id> --note "<what the user confirmed>"` | Records confirmation; phase → `confirm` → allowed to start |
| `cw task start --task <id>` | Preconditions: phase `classify` (s/m outside `workflow.confirm`) or `confirm`; main checkout clean for the ticket file; the claim for the ticket is still held by this session; base = main checkout's current branch + HEAD (or tip of `buildsOn`). Updates the claim payload (phase `implement`, branch). Renders `brief-implementer.md`. Phase → `implement`, round 1. Prints JSON `{ agent, description, prompt, brief }` — the orchestrator passes `agent` as `subagent_type`, `description` and `prompt` verbatim |
| `cw task agent --task <id> --role <r> --id <agentId>` | Records the agent id the Agent tool returned (needed for SendMessage and the mod) |
| `cw task review --task <id>` | Precondition: valid `done` report for the current round. Renders `brief-reviewer.md`. Phase → `review`. Prints `{ agent, description, prompt }` for the first round; for later rounds prints the SendMessage text for the same reviewer |
| `cw task return --task <id>` | Precondition: review `changes_requested`. Increments round (or → `escalated` at max). Prints the SendMessage text for the same implementer (blocking findings + cheap non-blocking ones flagged by the reviewer as `sendAlong`) |
| `cw task investigate --task <id> --question "<text>"` | Renders `brief-investigator.md`, prints `{ agent: "dev-workflow:investigator", description, prompt }` |
| `cw task phase --task <id> <phase> [--note]` | Generic transition with precondition checks (spec 01 §5.3) |
| `cw base-moved --task <id>` | `git fetch`; compares `base.commit` with local and `origin/<base.branch>` tips; if moved: `git merge-tree --write-tree --name-only <tip> <branch>` (conflicts) and the intersection of files changed in `base..tip` with the task's changed files. Exit 1 if a rebase is needed; prints the SendMessage text for the implementer (`git rebase --onto <tip> <base>`, rerun checks) and the reviewer brief for `<tip>..HEAD` (round not counted) |
| `cw pr title --task <id>` / `cw pr body --task <id> [--out <file>]` | Title from the first commit summary (or template); body from `git.pr.sections` sources (spec 01 §1.3). Default out: `tasks/<id>/pr-body.md` |
| `cw pr record --task <id> --url <url>` | Stores `prUrl`; phase → `deliver` if not yet |
| `cw task cleanup --task <id>` | Worktree mode: `git -C <wt> status --porcelain` empty and `HEAD` equals `origin/<branch>` → `git -C <main> worktree remove <wt>` (never `--force`), `git -C <main> branch -D <branch>`; otherwise keeps both and says why. In-place mode: switch `appRoot` back to the base branch if clean. Sub-tasks: cleans each |
| `cw task end --task <id> --outcome done\|escalated\|aborted [--no-pr <reason>]` | Final transition; releases the claim for `aborted`; for `done` the claim stays (phase `deliver`, PR URL) until `cw ticket gc` sees the ticket's row gone from `<remote>/<defaultBase>`; `escalated` keeps the claim |
| `cw task show <id>` / `cw task list [--all]` | Human summary or JSON |

### 4.2 Implementer side

| Command | Behaviour |
|---|---|
| `cw ws setup --task <id>` | Worktree mode: cwd must be a linked worktree (`--git-dir` ≠ `--git-common-dir`). Renames the temporary branch to the task branch (`git branch -m`); if `buildsOn` starts with `origin/`, `git fetch origin`; with `buildsOn`, `git reset --hard <buildsOn>` before any change. Checks every `isolation.symlink` path exists in the worktree. Records `worktree`. In-place mode: `appRoot` clean and on the base branch → `git switch -c <branch>`; else exit 3 `blocked` |
| `cw context --task <id>` | Prints package docs to read, applicable procedures (paths), applicable rule IDs with titles (by the task's packages/areas) and the knowledge-base duties |
| `cw step --task <id> --done <n> [--note <text>]` | Manual step marker for steps without a script (tests, implementation) |
| `cw checks [--task <id>] [--changed] [--base <sha>] [--package <id>…] [--only <check,…>] [--json]` | See 4.4 |
| `cw prove --task <id> --test <pkg>:<file>[::<name>] --change <file>…` | See 4.3 |
| `cw kb check --task <id>` | Warnings: feature task touching package sources without a `knowledgeBase.features` change; bugfix without a `lessons` entry; `deleteRowWhenDone` and the ticket row still present; docs referencing changed paths that were not touched (simple grep) |
| `cw ticket done <id>` | markdown-table: deletes the row in the current worktree's copy of the ticket file |
| `cw commit msg --task <id> --summary "<text>" [--keyword <k>] [--flag <f>] [--body-file <f>] --out <file>` | Builds the message: summary template, length checks, body wrapped at `bodyWrap` (lists, URLs and fenced code kept), trailers. The agent appends its own attribution lines if its instructions require, then runs `git commit -F <file>` |
| `cw git lint --task <id> [--last]` | Branch name against the template regex; every commit in `base..HEAD` (or the last): summary pattern and length, keyword, body wrap, trailers, no `fixup!`/`squash!`/`WIP`. Exit 1 with findings |
| `cw report save --task <id> [--round <n>]` | Reads agent JSON from stdin (status, ACs, migrations, docs, open points, blocked/misclassified), merges `cw` fields, validates (spec 01 §8), writes `report-<round>.json`, prints the final JSON in a ```json fence |
| `cw run <pack>:<script> [args…]` | Runs `node <packRoot>/scripts/<file>` with env `CW_REPO_ROOT`, `CW_COMMON_DIR`, `CW_PROFILE`, `CW_PACK_OPTIONS` (JSON), `CW_TASK` (if `--task`); exit code passes through |
| `cw deps where <name>` | node-npm: version and resolved directory from the nearest `package-lock.json` (`packages["node_modules/<name>"]`, workspace locks too) and `require.resolve` from each package dir |

### 4.3 `cw prove` and `cw mutate`

Purpose: evidence that a test covers the change (implementer) and that a test can fail (reviewer), without touching the agent's worktree.

Scratch copy (`fsx.scratchCopy(src)`): copy the worktree to `os.tmpdir()/dw-<random>` excluding `.git` and every `node_modules`; then, for every `node_modules` directory found in `src` (search skips `.git` and descends no further into `node_modules`), create a symlink at the same relative path in the copy. If the source `node_modules` itself is a symlink (worktree symlinks), link to its real path.

`cw prove`:
1. Scratch copy of the worktree at its current state.
2. In the copy, restore each `--change` file to its content at `base.commit` (`git show <base>:<file>`; delete it if it did not exist at base).
3. Run the single-test command (package `test.single`, else the test-runner pack template; vitest: `npx vitest run {file} -t "{name}"`) with the package's env and services, cwd = package dir in the copy. Expect a non-zero exit. Capture the first line matching `/(AssertionError|Expected|expected|FAIL|✗|×|Error:)/`.
4. Run the same command in the real worktree. Expect exit 0.
5. Append `{ test, command, failedWithout, failureLine, passesWith }` to `proofs.json`; remove the copy. Exit 0 if both expectations hold, else 1.

`cw mutate --task <id> --test <pkg>:<file>[::<name>] --remove <file>:<start>-<end> [--replace <text>]`: scratch copy at HEAD; delete (or replace) the line range; run the single test; `killed = exit ≠ 0`. Appends to `mutations.json`. Exit 0 if killed, 1 if it survived (a blocking CORE-TEST-SPEC finding).

### 4.4 `cw checks`

1. Changed files = `git diff --name-only <base>...HEAD` ∪ `git status --porcelain` paths (with `--changed`); else all packages or `--package`.
2. Map files to packages (longest path prefix); add `alsoCheck` (transitively, once); files without a package go to `unowned`.
3. Services: for each service any selected package needs, run `check`; if it fails and `start` exists, run `start`, re-check (timeout 60 s).
4. For each package in profile order, each check in map order (`--only` filters): acquire the exclusive lock `locks/<pkg>-<check>.lock` if listed in `exclusive` (wait, polling 2 s, up to 20 min, printing "waiting for <holder task>"); spawn the command via `sh -c` with `cwd = <repoRoot>/<path[0]>`, env = process env + package env; timeout `workflow.checkTimeoutMinutes`; log to `checks-<ts>/<pkg>-<check>.log`; keep the last 40 lines.
5. Stop services started in step 3 that have `stopIfStarted`.
6. Write `checks-<ts>.json` (with `--task`), print a table, exit 1 if any check failed.

### 4.5 Ticket adapters

Interface (`lib/ticket/*.mjs`): `list({ open })`, `show(id)`, `dependencies(id)`, `done(id)`, `exists(id, { ref })`, `newRow({ section, text, id })`. Adapters never store "in progress"; that is the claim registry's job (§4.7).

`markdown-table`:
- Parses every pipe table whose header row contains `columns.id` and `columns.status`. A row is `| <ID> | … |`; cells are split on unescaped `|`.
- `list --open`: rows whose status starts with `statusOpen`.
- `dependencies`: ticket IDs found in the `dependsColumn` cell that still have a row (= not done).
- `done`: deletes the row (implementer, in the task branch).
- `exists --ref HEAD`: reads the file with `git show HEAD:<file>`.
- `newRow`: appends a row to the table under the section heading with an ID reserved through `cw ticket reserve-id` (§4.7).
- Fixture tests use a copy of fisko's `plan/NEXT_STEPS.MD` (emoji statuses, long cells, `\|` inside cells).

`github-issues`: `gh issue list/view --json number,title,state,labels`; `dependencies` from the issue's "blocked by" relations; `done` closes nothing (the PR closes the issue with "Closes #n" in the body via the `spec.summary` section).

`none`: every operation is a no-op; `show` returns the task title.

### 4.6 Step markers

The implementer playbook has 9 steps; `cw` sets `steps.done` automatically:

| Step | Set by |
|---|---|
| 1 Workspace | `cw ws setup` |
| 2 Understand | `cw context` |
| 3 Tests first | `cw step --done 3` |
| 4 Implement | `cw step --done 4` |
| 5 Prove | `cw prove` (first success) |
| 6 Checks | `cw checks` (pass) |
| 7 Knowledge base | `cw kb check` |
| 8 Commit | `cw git lint` (pass) |
| 9 Report | `cw report save` |

A return round resets `steps` to `{ done: 0, total: 9 }`.

### 4.7 Claims and intake (`lib/claims.mjs`)

Format and git mechanics: spec 01 §5.4. Session identity: `CLAUDE_SESSION_ID` if the environment provides it, else `<host>:<checkout>:<ppid>`; `cw` stores it in `<common-dir>/dev-workflow/session-<ppid>.json` so later calls of the same session recognise their claims.

| Command | Behaviour |
|---|---|
| `cw intake <id>` | 1. `ticket gc`. 2. Ticket exists in `<remote>/<defaultBase>` (or locally for `local`), status is `statusOpen`, all `dependencies` done — else exit 3 with the reason. 3. Acquire the claim (`--force-with-lease=<ref>:`). Rejected → read the existing claim and exit 3 with holder, host, phase, since and whether it is stale. 4. `cw preflight --ticket <id>`; on errors the claim is released again and the errors printed. 5. Print the ticket row and the claim. |
| `cw intake --next` | Candidates = open tickets without claim whose dependencies are done, ordered by the backlog's order (section order, then row order; a "Suggested order" list in the file wins when present). Tries to claim the first; on a lost race tries the next (max 5). Prints the claimed ticket |
| `cw ticket list [--available] [--json]` | Backlog rows with live claim columns (holder, phase, since, stale); `--available` = what `--next` would consider |
| `cw ticket claims [--json]` | All claims on the remote (also those without a backlog row, e.g. orphans) |
| `cw ticket claim <id>` / `release <id>` | Manual acquire/release for work outside the orchestrator (a person editing by hand). `release` refuses claims of other sessions unless `--force` and confirmation text `--reason` |
| `cw ticket steal <id> --reason <text>` | Only for stale claims; records `stolenFrom` |
| `cw ticket gc` | Releases claims whose ticket row is gone from `<remote>/<defaultBase>`, and pushes `unsynced` local claims |
| `cw ticket reserve-id <prefix>` | Next free ID for the prefix: max over IDs in the backlog at HEAD, `<remote>/<defaultBase>` and reserved refs, +1; create `refs/ticket-ids/<ID>` with an empty lease; retry on rejection |
| `cw merge-driver ticket-table %O %A %B` | Git merge driver for the backlog file: parses the three versions into rows keyed by ID; deletions on either side win, additions from both sides are kept in table order, a row changed on both sides keeps "ours" and writes a conflict note line `<!-- dw: NV-9 changed on both sides -->` (exit 1 only if such a note was written). Registered by `cw init` (`.gitattributes`: `<file> merge=dw-ticket-table`; local git config `merge.dw-ticket-table.driver = cw merge-driver ticket-table %O %A %B`); `cw doctor` checks the config. It applies to local merges and rebases (`cw base-moved`), not to GitHub's merge button |

Every `cw task` transition updates the claim payload (`phase`, `round`, `branch`, `updatedAt`), so other sessions see the live phase.

## 5. Investigator and reviewer commands

| Command | Behaviour |
|---|---|
| `cw review scope --task <id>` | Diff stat; files outside the task's packages; foreign commits (below); non-goal hits (non-goal lines' key nouns found in added lines; advisory); pack scope scripts (`vitest:no-focus`, `docker:image-pins`, `node-npm:dependency-changes`) |
| `cw git foreign-commits --task <id>` | Commits in `base..HEAD` that are also contained in another local branch than the task branch (`git branch --contains`) or whose author date precedes the task's creation; prints the rebase command |
| `cw mutate …` | 4.3 |
| `cw rules applicable --task <id>` | spec 03 |
| `cw review save --task <id>` | stdin JSON → validate (spec 01 §9, including `rulesChecked` = applicable set) → `review-<round>.json` → prints the JSON fence |
| `cw investigation save --task <id>` | stdin JSON → validate (spec 01 §10) → `investigation.json` |

## 6. Misc

| Command | Behaviour |
|---|---|
| `cw agents eject [--matrix <file>] [--out .claude/agents]` | Writes project-local copies of the generated agents with a custom model matrix (same generator code as `tools/generate-agents.mjs`). Prints a warning that they shadow nothing: the orchestrator must then use the local names; `cw task start` reads `workflow.agentPrefix` (`dev-workflow:` default, `""` for ejected agents) |
| `cw ticket migrate-status` | One-off for existing backlogs: rows whose status cell is an "in progress" marker (e.g. `🔄 In progress — …`) are listed; for each the owner chooses "create claim" or "reset to open"; the status cell is reset in a commit the owner makes |
| `cw help [command]` | Usage |
| `cw version` | Plugin version, Node, git, Claude Code |

## 7. Test plan (summary)

- Unit tests per module with fixtures: TS monorepo (fisko-like: `fisko-api`, `fisko-app`, `fisko-shared`, migrations dir, NEXT_STEPS copy, workflows), single-package Node app, Python app (`pyproject.toml`, `alembic/`).
- Golden files for `rules build` output, `brief render`, `pr body`.
- State machine: every allowed and every refused transition.
- `checks`: fake commands (`node -e "process.exit(1)"`), exclusive lock contention with two processes, service start/stop with stub scripts.
- `prove`/`mutate`: fixture with a real `node --test` test that fails when a file is reverted.
- Claims: a bare repository as remote; two processes race for the same ticket (exactly one wins), update/release with stale lease fail, `--next` skips claimed and blocked tickets, gc after the row is removed on the remote branch, offline fallback and later sync, conflict reporting.
- Merge driver: three-way fixtures for parallel deletions of adjacent rows, parallel additions, a row changed on both sides.
- `init --write`: settings merge keeps unknown keys, unions arrays, refuses to touch `settings.local.json`; secret-scan test that no value from a fixture `settings.local.json` appears in any written file.
