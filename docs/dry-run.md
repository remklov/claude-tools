# Dry run: the P3 acceptance checklist

P3 is done when the workflow has run by hand in a project with Acme Shop's layout (`docs/PLAN.md` §14, P3 row). This checklist is that run. You follow it step by step in the Claude Code CLI and in the Desktop app, in both workspace modes, and record what you saw.

The kit builds the projects: `tests/dry-run/make-project.mjs` (section 2). Its test generates all four combinations of mode and host and checks them without npm and without network:

```sh
cd ~/Projects/claude-dev-workflow
```

```sh
node --test tests/dry-run/make-project.test.mjs
```

The test is outside the plugin's test glob, so the CI and `node --test plugins/dev-workflow/tests/*/*.test.mjs` do not run it.

## How to use this checklist

- Work from top to bottom. Every check has **Steps**, **Expected** and a **Record** line. Fill in the record lines in a copy of this file or in the P3 merge request, always with the surface and its version: `CLI 2.1.xxx`, or `Desktop <app version>, engine 2.1.xxx`.
- One command per block. A `sh` block runs in your own terminal (bash, zsh and fish all work); a `text` block is what you type into Claude Code.
- Paths: the marketplace checkout is `~/Projects/claude-dev-workflow`, on a branch that contains all of P3. The dry-run projects go to `~/dry-run/`.
- In your terminal, `cw` is `node ~/Projects/claude-dev-workflow/plugins/dev-workflow/cli/cw.mjs`, run in the project root: it finds `.claude/dev-workflow/config.json` by walking up from the current directory. Inside Claude Code, `cw` is on the Bash tool's PATH (the plugin's `bin/`).
- A task id is its branch with `/` replaced by `__` (§8), for example `NO-TICKET__feature__add-health-route`. `cw task list` prints it.
- While a task runs, read its state in your terminal only with `cw task list`, `cw task show` and `grep` on its files. Never run `cw report show` or `cw review show` yourself: they stamp `shownAt`, and the stop check then counts a report saved before that as an old one.
- A result that differs from **Expected** is a finding: record the exact message and go on. Do not fix the plugin inside a dry-run project.
- A check that the model never reaches (it answers in text instead of calling the tool) is recorded as "not checked", never as passed.
- Permission mode: the checks assume that Claude Code asks before edits and commands that no rule allows. A `defaultMode` in your user settings (for example `"auto"`, where a classifier decides instead of the allow rules) changes that, so every CLI start below passes `--permission-mode manual` (the asking mode; `claude --help` on CLI 2.1.306 lists `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk` and `plan`). In the Desktop app pick the asking mode for 6.3 and 6.4; 6.5 switches to auto mode on purpose.

## What each acceptance item is checked by

| P3 acceptance item (§14) | Checks |
|---|---|
| `/dev-workflow:ticket NO-TICKET <task>` runs an S task end to end | 3.4, 4.2, 5.3 |
| The PR command is printed for gh, and for glab in a GitLab variant | 3.4, 5.3 (gh), 4.2 (glab) |
| `app/` is back on the base afterwards | 3.4, 3.5, 3.6, 4.2 |
| Edit/Write refused in the main session during the task, allowed after `cw task end` | 3.4, 5.3 |
| A session without the command behaves normally | 3.3, 5.2, 6.3 |
| The same in worktree mode | 5.2, 5.3 |
| `/clear` during a task, then the command again: rebind after confirmation, G-ORCH-EDIT in the new session | 3.6 |
| blocked → SendMessage → new report round, in the CLI and in the Desktop app | 3.5, 6.4 |
| A second review round (`cw review show` prints `Review round 2/3` after changes were requested), in the CLI and in the Desktop app | 3.5, 6.4 |
| One SubagentStop block in the Desktop app | 6.4 |
| Once in the Desktop app in auto mode | 6.5 |

The checks the plan marks as untested:

| Untested so far | Checks |
|---|---|
| U1: a SendMessage continuation waits for the next report (D4) | 3.5, 6.4 |
| U2: `cw rules build` under the sandbox (the lock file write) | 3.7 |
| U3: `git commit -F <absolute message path>` in a worktree-isolated agent | 5.3 |
| U4: `cw prove`'s temporary worktree under the sandbox | 3.4 (in-place), 5.3 (worktree) |
| U5: the relative `git -C app` commands with the allow rules from `cw init` (no prompt) | 3.1, 3.3, 3.4 |

The open questions of the P3 builds:

| Open question | Checks |
|---|---|
| The commit needs no permission prompt: the implementer writes no file under `.git` (a protected path) | 3.4, 5.3, 6.4 |
| The allow rules match only the printed form: `git -C app add` runs, `git -C ./app add` prompts; no settings warning at startup | 3.2, 3.3 |
| The in-place implementer's Bash cwd is the project root (`cw context` prints no `Note:`), in the CLI and the Desktop app | 3.4, 6.4 |
| A PreToolUse deny on a Bash call (G-FORCE) and on an Agent call (G-AGENT-PARAMS) blocks the call and shows the reason, in the CLI and the Desktop app | 3.3, 6.3 |
| The orchestrator reads the ticket skill's step files with `cw playbook read`, without a prompt; `$ARGUMENTS` is substituted | 3.4, 6.5 |
| Text for `cw` (ticket, spec, report, review) goes through a scratchpad file and `cw … < <file>`, without a prompt; a `cd` that stays is refused (G-CD) | 3.4, 3.5, 5.3 |
| The orchestrator waits for every agent (the printed ones and Explore): in the foreground where the Agent tool has `run_in_background`, otherwise until the agent's report arrives as a message; the Agent result names the agent id | 3.4 |
| AskUserQuestion takes up to `workflow.maxQuestionsPerRound` (4) questions in one call | 3.4 |
| SubagentStart runs again when the orchestrator continues an agent with SendMessage (`startedAt` changes) | 3.5 |
| The hooks write the task state while the sandbox is on (hooks run outside the sandbox, code.claude.com/docs/en/sandboxing) | 3.4 |
| A hook run takes less than 300 ms in a real session (D11) | 3.4 |
| The Desktop app's hooks find Node 20 or later | 6.3 |
| The worktree agent's heredocs (`cw commit msg --body-file -`, `cw report save`) and `(cd <dir> && …)` subshells pass the harness | 5.3 |
| In a normal session the model invokes neither agent playbook; `/dev-workflow:status` and `/dev-workflow:doctor` are in the `/` menu, the ticket skill with its argument hint | 3.3 |
| `/dev-workflow:ticket` starts from the Desktop prompt | 6.4 |
| The auto-mode classifier lets `git -C app commit -F <file>` and the first read outside the project through | 6.5 |
| `getJiraIssue` returns the status and the assignee in a form the snapshot takes | 3.8 (optional) |
| The `/sandbox` mode is per project | 3.2, 3.7 |

Section 8 lists what the kit itself assumes; the steps above confirm it on the way.

## 1. Before you start

### 1.1 Versions

**Steps**

```sh
claude --version
```

```sh
node --version
```

```sh
npm --version
```

```sh
git --version
```

In the Desktop app: **Claude → About Claude** shows the app version. Section 6.3 reads the engine version.

**Expected:** Claude Code 2.1.296 or later (D10), Node 20 or later, git 2.31 or later.

- [ ] Record: CLI ____, Desktop app ____, Node ____, npm ____, git ____

### 1.2 No other copy of the plugin

**Steps**

```sh
claude plugin list
```

```sh
claude plugin marketplace list
```

**Expected:** no `dev-workflow` plugin and no `remklov` marketplace. If one is listed, stop and note its scope and source: the CLI runs load the plugin with `--plugin-dir`, the Desktop run installs it from a directory marketplace, and a same-name directory marketplace replaces a git one with only a notice (S6).

- [ ] Record: nothing installed / found: ____

### 1.3 Local binding for the sandbox

The API test binds a local port through supertest; in the sandbox on macOS that needs `sandbox.network.allowLocalBinding` (cw doctor warns without it).

**Steps**

```sh
grep -n allowLocalBinding ~/.claude/settings.json
```

**Expected:** `"allowLocalBinding": true` inside `sandbox.network`. If it is missing, add it to `~/.claude/settings.json` before you go on, and note that you did: it applies to every project, and section 7 removes it again if you added it only for the dry run.

- [ ] Record: set already / added for the dry run

### 1.4 The kit's test

**Steps**

```sh
cd ~/Projects/claude-dev-workflow
```

```sh
node --test tests/dry-run/make-project.test.mjs
```

**Expected:** 5 tests pass: one per combination of `--mode in-place|worktree` and `--host github|gitlab`, and the refusals.

- [ ] Record: Node ____: pass / fail

## 2. What make-project builds

```text
node tests/dry-run/make-project.mjs <target dir> [--mode in-place|worktree] [--host github|gitlab]
```

- **in-place** (default): `<target>` is the outer repository with `.claude/dev-workflow/config.json`; the application is the nested repository `<target>/app`, which the outer repository ignores (Acme Shop's layout, D5).
- **worktree**: `<target>` is a single repository with the application and the config.
- **The application**: npm workspaces with `packages/web` (React 19, Vite, Vitest, Testing Library, ESLint, TypeScript) and `packages/api` (Express 5 with `createApp()`, TypeScript with NodeNext, Vitest, supertest, ESLint). Each has `test`, `lint` and `typecheck` scripts and one passing test. The product copy is German, as in Acme Shop.
- **The origin**: the fetch URL is `git@github.com:acme/dry-run.git` (`--host gitlab`: `git@gitlab.example.com:acme/dry-run.git`, a name under the reserved `example.com` domain, so no real GitLab is expected to answer), so cw detects the host and builds the gh or glab command. The push URL is the bare repository `<target>/.dry-run/origin.git`, so a push lands on your machine. make-project pushes `main` once, which also creates `origin/main`.
- **The dev-workflow files** come from cw: `cw init --detect --json` proposes the config, make-project sets the project name, the languages (`en`, product copy `de`) and the no-ticket key `NO-TICKET`, and `cw init --write` writes the config, the compiled rules and lock, `.claude/settings.json` (in-place with the allow rules `Bash(git -C app add *)` and `Bash(git -C app commit *)`), the `CLAUDE.md` section and `scripts/setup-dev-workflow.sh`. Everything is committed. The project's `.gitignore` also ignores `.claude/settings.local.json`, where `/sandbox` saves its mode.
- **gh and glab stubs** in `<target>/.dry-run/bin/`. `cw pr command` asks gh or glab for an existing PR/MR before it prints anything (D7), and `acme/dry-run` does not exist, so the real CLIs would fail there. The stubs answer "no PR/MR yet", and `gh pr create` / `glab mr create` print a made-up URL without creating anything. They keep a run off the network only where they come first on the Bash tool's PATH: 3.2 checks that for the CLI, and the Desktop app uses your real gh and glab (6.3).
- **`<target>/.dry-run/start-cli.sh`** starts the CLI in the project root with the stubs first on PATH and `--plugin-dir ~/Projects/claude-dev-workflow/plugins/dev-workflow` ("Load a plugin from a directory or .zip for this session only", `claude --help`, CLI 2.1.303). It passes its arguments on to `claude`.
- make-project never runs npm and needs no network. It prints the npm and git commands to run next. It refuses inside Claude Code (`cw init --write` would refuse there), a target that is not empty, and a target inside a git repository; every refusal names the fix.

## 3. CLI, in-place, GitHub (`~/dry-run/cli-in-place`)

### 3.1 Prepare the project

**Steps**

```sh
node ~/Projects/claude-dev-workflow/tests/dry-run/make-project.mjs ~/dry-run/cli-in-place --mode in-place --host github
```

```sh
cd ~/dry-run/cli-in-place/app
```

```sh
npm install
```

```sh
git add package-lock.json
```

```sh
git commit -m '[TASK] Add the npm lockfile'
```

```sh
git push origin main
```

```sh
cd ~/dry-run/cli-in-place
```

```sh
node ~/Projects/claude-dev-workflow/plugins/dev-workflow/cli/cw.mjs checks
```

```sh
node ~/Projects/claude-dev-workflow/plugins/dev-workflow/cli/cw.mjs doctor
```

```sh
grep -n 'git -C app' .claude/settings.json
```

**Expected**

- make-project exits 0 and lists the packs `express (5), node-npm, react-vite (react-19), typescript, vitest` and the packages `api (packages/api), web (packages/web)`.
- `npm install` succeeds; the push goes to `~/dry-run/cli-in-place/.dry-run/origin.git`.
- `cw checks` passes test, typecheck and lint for `api` and `web`.
- `cw doctor` shows no `ERROR` line.
- `.claude/settings.json` allows `Bash(git -C app add *)`, `Bash(git -C app commit *)` and the read-only `git -C app status|diff|log|show|ls-files|rev-parse *` and `git -C app branch --show-current` (§12, the in-place rules `cw init` writes in P3). Without them U5 cannot pass: record it.

- [ ] Record: npm install ok / failed: ____ · cw checks pass / fail: ____ · doctor errors: ____ · `git -C app` allow rules present / missing

### 3.2 Start the CLI

**Steps**

Start the CLI with a debug log, so that 3.4 can read the hook durations ("start Claude Code with `claude --debug-file <path>` to write the log to a known location", code.claude.com/docs/en/hooks, "Debug hooks"):

```sh
~/dry-run/cli-in-place/.dry-run/start-cli.sh --permission-mode manual --debug-file ~/dry-run/cli-in-place/.dry-run/debug.log
```

Trust the folder when Claude Code asks. Note any warning about the settings at startup. Then turn the sandbox on in the mode that keeps permission prompts, so the allow rules decide and the sandbox still applies:

```text
/sandbox
```

In the panel: enable the sandbox and choose the mode **regular permissions** ("Auto-allow runs sandboxed commands without prompting, and regular permissions keeps the regular permission prompts even when commands are sandboxed", code.claude.com/docs/en/sandboxing). The same page says where the choice goes: "Claude Code saves it to your project's local settings at `.claude/settings.local.json`, which apply to the current project. Claude Code adds that file to your global gitignore when it saves a setting there." So the mode holds for this project only; 4.1 and 5.2 turn it on again for theirs, and section 7 lists the global gitignore entry.

```sh
grep -n -A4 sandbox ~/dry-run/cli-in-place/.claude/settings.local.json
```

```text
Run these with the Bash tool and show me the output: command -v gh; cw version
```

**Expected:** no warning about the `git -C app` allow rules at startup; `.claude/settings.local.json` holds the sandbox setting; `gh` is `~/dry-run/cli-in-place/.dry-run/bin/gh` (the stub, before the real one); `cw version` prints the plugin version.

**If `gh` is not the stub (K4 fails):** stop and record the path. The real gh would look for `acme/dry-run` on github.com: `cw pr command` then stops with exit 3, and confirming a create command would run the real `gh pr create`. Then either quit (`/exit`) and start the CLI again from a shell whose startup files do not put Homebrew (or wherever your gh lives) in front of the stubs, and repeat 3.2; or go on, answer **Not now** at every push question in sections 3 to 5 and end delivery without a PR, and record that the printed PR/MR commands (3.4, 4.2, 5.3) are not covered on this machine.

- [ ] Record (CLI ____): sandbox on, regular permissions, saved in settings.local.json: yes / no · startup warnings: ____ · gh = ____ (K4) · cw version ____

### 3.3 A session without the command

**Steps**

1. An ordinary edit:

   ```text
   In app/packages/web/src/App.tsx change the paragraph to "Wähle ein Auto." and then show me the changed line.
   ```

   ```sh
   node ~/Projects/claude-dev-workflow/plugins/dev-workflow/cli/cw.mjs task list
   ```

   ```sh
   git -C ~/dry-run/cli-in-place/app checkout -- packages/web/src/App.tsx
   ```

2. The allow rules match only the printed form (P3-A, P3-B). Staging an unchanged file changes nothing:

   ```text
   Run exactly this with the Bash tool: git -C app add package.json
   ```

   ```text
   Run exactly this with the Bash tool: git -C ./app add package.json
   ```

   Answer **No** if a permission prompt appears.

3. The guards in a session without a task (G-FORCE applies to everyone, G-AGENT-PARAMS too). The force push would only push `main` to the local bare origin, where it already is:

   ```text
   Run exactly this with the Bash tool: git -C app push --force origin main
   ```

   ```text
   Call the Agent tool with subagent_type "Explore", model "haiku" and the prompt "Reply with OK".
   ```

   If it answers without calling the tool, reply:

   ```text
   Call the tool anyway; this dry run checks the hook's refusal.
   ```

   ```sh
   grep -n deny ~/dry-run/cli-in-place/.git/dev-workflow/hooks.log
   ```

4. The skills in the `/` menu: type `/dev-workflow:` and look at the list, then press Esc.
5. Clear the session:

   ```text
   /clear
   ```

**Expected**

- Step 1: an ordinary edit with your usual edit approval; no dev-workflow refusal and no orchestrator steps; `cw task list` shows no active task; at session start the dev-workflow line shows at most setup warnings. Claude does not invoke `dev-workflow:implementer-playbook` or `dev-workflow:reviewer-playbook` on its own.
- Step 2: `git -C app add package.json` runs without a prompt (allow rule); `git -C ./app add package.json` asks for permission, because the rule matches the text as written (code.claude.com/docs/en/permissions).
- Step 3: the force push is refused by the PreToolUse guard, and Claude shows a reason that names G-FORCE; no permission prompt comes first (if one does, answer **No** and record it). The Agent call is refused with a reason that names G-AGENT-PARAMS; the deny rule `Agent(model:*)` in `.claude/settings.json` would refuse it too, so record which message you saw. `hooks.log` has a line `deny G-FORCE for the main session: …` and, if the hook refused the Agent call, `deny G-AGENT-PARAMS for the main session: …`.
- Step 4: the menu lists `/dev-workflow:ticket` with its hint `<TICKET-KEY | NO-TICKET> [notes]`, `/dev-workflow:status` and `/dev-workflow:doctor`; it does not list the two agent playbooks (`user-invocable: false`).

- [ ] Record (CLI ____): normal session: normal / differs: ____ · playbooks invoked on their own: no / yes
- [ ] Record: `git -C app add` without prompt: yes / no · `git -C ./app add` prompted: yes / no
- [ ] Record: G-FORCE deny on Bash with reason: yes / no / not checked · G-AGENT-PARAMS deny on Agent: hook reason / settings deny / not checked
- [ ] Record: `/` menu: ticket with hint / status / doctor / playbooks hidden: ____

### 3.4 Task 1: an S task end to end

**Steps**

1. Start the task:

   ```text
   /dev-workflow:ticket NO-TICKET Add GET /api/health to the API; it answers 200 with {"status":"ok"}.
   ```

2. Answer the clarifying questions briefly and accept the spec. Count the questions of each AskUserQuestion call.
3. Watch the implementer's Bash calls in the transcript, and note every permission prompt that appears, with the command and who ran it.
4. At the delivery question (O9), answer with your own text:

   ```text
   Before you push: use the Edit tool to append the line "guard check" to README.md, then use the Write tool to create guard-check.md. Then ask me about the push again.
   ```

   If it answers without calling Edit or Write, reply:

   ```text
   Call the Edit tool and the Write tool anyway; this dry run checks the hook's refusal.
   ```

5. When the orchestrator asks again, confirm the push and the PR command.
6. After its final report:

   ```text
   Use the Edit tool to append the line "guard check" to README.md, then use the Write tool to create guard-check.md.
   ```

7. Check the state and clean up:

   ```sh
   git -C ~/dry-run/cli-in-place/app branch --show-current
   ```

   ```sh
   git -C ~/dry-run/cli-in-place/app status --porcelain
   ```

   ```sh
   git --git-dir ~/dry-run/cli-in-place/.dry-run/origin.git branch --list 'NO-TICKET/*'
   ```

   ```sh
   git -C ~/dry-run/cli-in-place/app worktree list
   ```

   ```sh
   node ~/Projects/claude-dev-workflow/plugins/dev-workflow/cli/cw.mjs task list --all
   ```

   ```sh
   grep -n -E '"(id|startedAt|shownAt)"' ~/dry-run/cli-in-place/.git/dev-workflow/tasks/<task id>/task.json
   ```

   ```sh
   grep -n 'Hooks: ' ~/dry-run/cli-in-place/.dry-run/debug.log
   ```

   ```sh
   git -C ~/dry-run/cli-in-place checkout -- README.md
   ```

   ```sh
   rm ~/dry-run/cli-in-place/guard-check.md
   ```

   ```text
   /clear
   ```

**Expected**

- O1: `cw doctor --quick`, no Jira call (NO-TICKET). The orchestrator works with the ticket and the notes of the command (`$ARGUMENTS` substituted), and reads `steps/o1-intake.md` and the other step files with `cw playbook read`, without a permission prompt (a Read of the plugin directory would ask, observed in the P3 dry run). `cw ticket save` and `cw spec save` read a file the orchestrator wrote into its scratchpad (`… < <scratchpad>/<id>-spec-1.md`), without a prompt. If it calls the Explore agent, the call carries `run_in_background: false` and the orchestrator waits for its result before it asks.
- O2: at most 4 questions per AskUserQuestion call (`workflow.maxQuestionsPerRound`).
- O3: `cw task new` with a branch `NO-TICKET/feature/<slug>`. O4: complexity s (an m is fine; record it). No O5 confirmation for s.
- O6: the Agent call names `dev-workflow:implementer-s` with no `isolation`. The Agent tool of the interactive CLI 2.1.306 has no `run_in_background`: the call returns at once ("Async agent launched"), the orchestrator records the agent id from the Agent result with `cw task agent --task <id> --role implementer --id <agentId>`, says that the implementer is working, and runs nothing else for the task until the report arrives as a message.
- The implementer: `cw ws setup` puts `app/` on the task branch; `cw context` prints no `Note:` line (its Bash cwd is the project root, P3-C); `cw context` and every later git command use the relative form `git -C app …` (P3); it commits with `git -C app add …` and `git -C app commit -F <message file>`. The body, if any, goes in with `cw commit msg … --body-file - <<'EOF'`, attribution lines with `--trailer`.
- U5: neither `git -C app add` nor `git -C app commit` nor the read-only `git -C app status|diff|log|show` of the reviewer nor any `cw` call asks for permission (also `cw report save` and `cw review save`, which read a scratchpad file), and no prompt names a path under `.git/` (the implementer writes no file there: `.git` is a protected path where every write is prompted and no allow rule helps, code.claude.com/docs/en/permission-modes). A prompt for an Edit or Write of `.git/dev-workflow/tasks/<id>/commit-msg.txt` is a finding.
- U4: `cw prove` records a proof that holds for the new test, without EPERM under the sandbox; afterwards `git -C … worktree list` shows only `app` itself (cw removed its temporary worktree). The reviewer's `cw prove --recheck` works the same way.
- O7/O8: the orchestrator reads the report with `cw report show` and the review with `cw review show`, not from the Agent result.
- Step 4: G-ORCH-EDIT refuses the Edit and the Write, and the transcript shows the PreToolUse deny reason, which names G-ORCH-EDIT and `cw task end`. Only such a refusal counts; a refusal in text without a tool call is "not checked".
- O9: `cw pr command` prints exactly two commands: `git -C app push origin NO-TICKET/feature/<slug>` and `gh pr create --repo github.com/acme/dry-run -B main -H NO-TICKET/feature/<slug> -t '<title>' -F <…/pr-body.md>`. An absolute `git -C /…/app` push means the P3 relative form is missing. The push asks for permission (ask rule `Bash(git -C * push *)`) and lands in the bare origin; the stub prints `https://github.com/acme/dry-run/pull/1`, and the orchestrator records it with `cw pr record --url`.
- O10: `cw task cleanup` switches `app/` back to `main` with a clean status; `cw task end --outcome done`; the short report names the classification, the review rounds and the PR link.
- Step 6: Edit and Write work again (only the usual edit approval).
- Step 7: `main`, an empty status, the task branch in the bare origin, one worktree, the task with outcome `done`. `task.json` holds an `id` and a `startedAt` for the implementer and the reviewer: the SubagentStart hook recorded them while the sandbox was on (hooks run outside the sandbox: "command hooks … run with your full access", code.claude.com/docs/en/sandboxing). The `Hooks:` lines of the dev-workflow hooks (`session-start.mjs`, `subagent-start.mjs`, `subagent-stop.mjs`, `guard.mjs`) end in durations below 300 ms (D11; the line format is in code.claude.com/docs/en/hooks, "Debug hooks").

- [ ] Record (CLI ____): end to end pass / fail: ____ · complexity ____ · review rounds ____
- [ ] Record: step files read without prompt: yes / no · arguments and skill dir substituted: yes / no · Explore used: yes, waited for its result / yes, went on without it / no
- [ ] Record: questions per AskUserQuestion call, most: ____ · Agent call waited and the agent id came from its result: yes / no
- [ ] Record: permission prompts that appeared (command, agent): ____
- [ ] Record: U5 `git -C app add/commit` without prompt, nothing written under `.git` by the agent: yes / no: ____ · `cw context` Note: none / ____
- [ ] Record: U4 prove under the sandbox: ok / EPERM / other: ____
- [ ] Record: G-ORCH-EDIT during the task: Edit refused / Write refused / not checked / message: ____; allowed after `cw task end`: yes / no
- [ ] Record: printed push and PR commands, verbatim: ____
- [ ] Record: `app/` on main and clean after the task: yes / no · agents recorded under the sandbox: yes / no
- [ ] Record: slowest dev-workflow hook in the debug log: ____ ms (event, hook)

### 3.5 Task 2: blocked, SendMessage and a second review round

The task asks for a library the API does not have. The implementer may not add a dependency (CORE-DEPENDENCIES; G-DEPS refuses `npm install` for workflow agents), so it reports `blocked`, and your answer goes to the same implementer by SendMessage.

The second review round of the acceptance is the review loop: the reviewer requests changes, `cw task return` sends the findings to the same implementer, and `cw task review` sends the next review to the same reviewer, so `cw review show` prints `Review round 2/3`. Your answer to the blocked report provokes it: it asks the implementer to leave out one test, which the reviewer must request (a criterion without a test is a blocking CORE-TEST-SPEC finding, R3). The change you ask for at delivery then restarts the cycle (O8: a spec change after an approval); that new cycle starts again at review round 1 (§8) and checks the SendMessage to the same implementer and reviewer, not the second review round.

**Steps**

1. Start the task:

   ```text
   /dev-workflow:ticket NO-TICKET Add POST /api/rentals. It takes {"vehicleId": string, "days": integer from 1 to 30} and answers 201 with {"vehicleId", "days", "total"}, where total is the vehicle's pricePerDay times days. An invalid body answers 400 with {"error": "<message>"}. Validate the body with the zod library.
   ```

2. The orchestrator asks in O2 whether zod may be added as a dependency (a library named in the request is not yet approved). Answer that it may (`Yes, add zod to the api package.`), so that the implementer reports `blocked` when it finds zod missing. Do not install zod when the orchestrator asks you to after the blocked report: step 3 withdraws the approval.
3. When the orchestrator brings you the blocked report, note the task id (`cw task list`) and first run in your terminal:

   ```sh
   grep -n -E '"(id|startedAt|shownAt)"' ~/dry-run/cli-in-place/.git/dev-workflow/tasks/<task id>/task.json
   ```

   Then answer:

   ```text
   No new dependency: validate the body by hand, without zod. Pass this on to the implementer as well: for this dry run, write no test for the 400 answer in this round; the review is to ask for it.
   ```

4. Watch the SendMessage to the implementer and what the orchestrator does right after it (U1). When the orchestrator shows the new report, run the same `grep` again.
5. Watch the review rounds: `cw task review`, `cw review show`, `cw task return`, the SendMessage to the implementer, its report, and the next `cw task review` with a SendMessage to the reviewer.
6. At the delivery question (O9), answer:

   ```text
   Not yet: also return "currency": "EUR" in the 201 response.
   ```

7. Confirm delivery when the orchestrator asks again. Then check:

   ```sh
   ls ~/dry-run/cli-in-place/.git/dev-workflow/tasks/
   ```

   ```sh
   ls ~/dry-run/cli-in-place/.git/dev-workflow/tasks/<task id>/
   ```

   ```sh
   grep -n 'review round' ~/dry-run/cli-in-place/.git/dev-workflow/tasks/<task id>/task.json
   ```

   ```sh
   git -C ~/dry-run/cli-in-place/app branch --show-current
   ```

   ```text
   /clear
   ```

**Expected**

- The implementer's report is `blocked` and names the missing dependency. The orchestrator asks you (a dependency is your decision), saves the changed spec (`cw spec save`, allowed while the round's report is blocked) and sends your answer, with the request about the test, by SendMessage to the **same** implementer (the agent id `cw task agent` recorded).
- U1: the orchestrator runs `cw report show` only after the implementer saved its new report, and `cw report show` shows status `done`, not the old `blocked`. Note whether the SendMessage call returned after the implementer finished or at once.
- SubagentStart and SendMessage: the second `grep` shows a later `startedAt` for the implementer than the first (the hook ran again for the continued agent; the hooks documentation says SubagentStart runs "when Claude resumes a subagent" and does not name SendMessage). If `startedAt` did not change, record it: the stop check still works through `shownAt`.
- Review round 1: `cw review show` prints `Review round 1/3: changes_requested` with a blocking finding for the missing 400 test (CORE-TEST-SPEC). `cw task return` prints a SendMessage to the **same** implementer; it adds the test and reports again; `cw task review` prints a SendMessage to the **same** reviewer, and `cw review show` prints `Review round 2/3` (approved, or changes requested once more). Only this counts as the second review round.
- Step 6: `cw spec save`, then `cw task return --spec-changed --note …`, a SendMessage to the **same** implementer, a new report, then `cw task review` with a SendMessage to the **same** reviewer, and `cw review show` prints `Review round 1/3`: the spec change started a new cycle.
- Step 7: the task directory holds `report-1.json` to `report-3.json` and `review-1.json` to `review-3.json`, more if a review requested changes once more (`round` counts the implementer rounds: the blocked report and its successor share round 1, the findings round is 2, the spec change round 3; §8). The `review round` lines of `task.json` read `review round 1`, `review round 1 requested changes`, `review round 2`, then `review round 1` again. Delivery as in 3.4; `app/` is back on `main`.
- If the implementer wrote the 400 test anyway, or the reviewer approved round 1: the second review round is not reached. Record why, and repeat this section as a new task with `/api/reservations` instead of `/api/rentals`. If the orchestrator refuses to pass the request on, record its reason.
- A SubagentStop block is not required in the CLI; if one happens, the transcript shows the hook's reason with the `cw` command to run.

- [ ] Record (CLI ____): blocked → SendMessage → new report: pass / fail: ____
- [ ] Record: U1 SendMessage waits for the next report: yes / no; what happened: ____
- [ ] Record: implementer `startedAt` changed after the SendMessage: yes / no
- [ ] Record: `Review round 2/3` after changes_requested → `cw task return` → SendMessage → `cw task review`: yes / no · how the changes came: the missing test / on its own / not reached
- [ ] Record: spec change: new cycle with `Review round 1/3`, same implementer and same reviewer agent: yes / no
- [ ] Record: SubagentStop block seen in the CLI: yes / no

### 3.6 Task 3: `/clear` and the rebind

**Steps**

1. Start the task; the note gives you a pause after the task exists:

   ```text
   /dev-workflow:ticket NO-TICKET Show the vehicle list from GET /api/vehicles on the web page. Dry run: after cw spec lint, stop and ask me before you classify.
   ```

2. Answer the clarifying questions. When it asks before classifying, check the task in your terminal:

   ```sh
   node ~/Projects/claude-dev-workflow/plugins/dev-workflow/cli/cw.mjs task list
   ```

3. Press Esc to leave the question, then:

   ```text
   /clear
   ```

   ```text
   /dev-workflow:ticket NO-TICKET
   ```

4. Confirm that it should resume the listed task. Then:

   ```text
   Use the Edit tool to append the line "guard check" to README.md.
   ```

   If it answers without calling Edit, reply:

   ```text
   Call the Edit tool anyway; this dry run checks the hook's refusal.
   ```

5. End the task:

   ```text
   Abort this task.
   ```

   ```sh
   node ~/Projects/claude-dev-workflow/plugins/dev-workflow/cli/cw.mjs task list --all
   ```

   ```sh
   git -C ~/dry-run/cli-in-place/app branch --show-current
   ```

   ```text
   /clear
   ```

**Expected**

- Step 2: one active task in phase `spec`.
- Step 3: `/clear` gives the conversation a new session id, so the binding ends (D3). The command lists the active `NO-TICKET` tasks and asks which one to resume; it never rebinds a no-ticket task by itself.
- Step 4: after your confirmation `cw task new --rebind <id>` makes this session the owner. Its output names the task's phase (`spec`) and the next command (`cw spec show --task <id>`), and the orchestrator continues at the step of that phase (O3). G-ORCH-EDIT refuses the Edit in this new session, with the deny reason in the transcript.
- Step 5: the orchestrator ends the task with `cw task end --outcome aborted` (with `cw task cleanup` first if it touched `app/`); the task is listed as aborted; `app/` is on `main`.

- [ ] Record (CLI ____): asked before the rebind: yes / no · rebind output (phase, next) ____ · resumed at step ____ · G-ORCH-EDIT in the new session: refused / allowed / not checked

### 3.7 `cw rules build` under the sandbox (U2)

S8 showed sandboxed writes to `.claude/rules/dev-workflow/`; the lock file `.claude/dev-workflow/rulebook.lock.json` was not part of it. The sandbox documentation's protected paths name the `.claude` settings files and the `skills`, `agents`, `commands` and `hooks` directories, not `.claude/dev-workflow/`, so the write should pass.

**Steps**

```sh
rm ~/dry-run/cli-in-place/.claude/dev-workflow/rulebook.lock.json
```

With no active task and the sandbox still on:

```text
Run cw rules build with the Bash tool, inside the sandbox, and show me its output.
```

```sh
git -C ~/dry-run/cli-in-place status --porcelain
```

```sh
git -C ~/dry-run/cli-in-place check-ignore -v .claude/settings.local.json
```

**Expected:** `cw rules build` exits 0 inside the sandbox (no EPERM, no unsandboxed retry), and the status is empty: the rebuilt lock equals the committed one, and `.claude/settings.local.json` with the sandbox mode is ignored (the project's `.gitignore` names it; your global gitignore may name it too).

- [ ] Record (CLI ____): U2 lock write under the sandbox: ok / EPERM / other: ____ · status empty: yes / no: ____

### 3.8 Optional: one Jira read

Only with Atlassian's `atlassian` plugin (`atlassian@claude-plugins-official`) enabled and logged in (`/mcp`), and a Jira issue you may read. The dry-run project uses the default source `local`: add `"tickets": { "source": "jira" }` to `.claude/dev-workflow/config.json` for this check and remove it afterwards. It has no `tickets.site`, so the orchestrator first asks `getAccessibleAtlassianResources` for the site id (`reference/jira.md`). Nothing is written to Jira.

**Steps**

1. Start the task with your key:

   ```text
   /dev-workflow:ticket <JIRA-KEY> Dry run: after cw ticket save, stop and ask me before you write the spec.
   ```

2. When it asks, check the snapshot in your terminal:

   ```sh
   node ~/Projects/claude-dev-workflow/plugins/dev-workflow/cli/cw.mjs task list
   ```

   ```sh
   cat ~/dry-run/cli-in-place/.git/dev-workflow/tasks/<task id>/ticket.json
   ```

3. End the task:

   ```text
   Abort this task.
   ```

**Expected:** one `getJiraIssue` call (after at most one `getAccessibleAtlassianResources` call), no other Jira tool; `ticket.json` has the issue's `summary`, the status name in `status`, the assignee's display name in `assignee` (or `null`), its `url` and `"source": "jira"`. The task ends as aborted.

- [ ] Record (CLI ____): Jira read: done / skipped (why: ____) · status and assignee mapped: yes / no: ____

Quit Claude Code (`/exit`).

## 4. CLI, in-place, GitLab (`~/dry-run/cli-gitlab`)

### 4.1 Prepare the project

**Steps**

```sh
node ~/Projects/claude-dev-workflow/tests/dry-run/make-project.mjs ~/dry-run/cli-gitlab --mode in-place --host gitlab
```

```sh
cd ~/dry-run/cli-gitlab/app
```

```sh
npm install
```

```sh
git add package-lock.json
```

```sh
git commit -m '[TASK] Add the npm lockfile'
```

```sh
git push origin main
```

```sh
cd ~/dry-run/cli-gitlab
```

```sh
node ~/Projects/claude-dev-workflow/plugins/dev-workflow/cli/cw.mjs checks
```

```sh
~/dry-run/cli-gitlab/.dry-run/start-cli.sh --permission-mode manual
```

Trust the folder, then turn the sandbox on with **regular permissions** as in 3.2 (the mode of 3.2 belongs to the other project):

```text
/sandbox
```

```text
Run these with the Bash tool and show me the output: command -v glab
```

**Expected:** as in 3.1; `cw checks` passes; `glab` is `~/dry-run/cli-gitlab/.dry-run/bin/glab` (if not, follow the K4 branch of 3.2).

- [ ] Record (CLI ____): prepared: yes / no: ____ · sandbox on: yes / no · glab = ____

### 4.2 Task: the MR command for glab

**Steps**

```text
/dev-workflow:ticket NO-TICKET Add GET /api/health to the API; it answers 200 with {"status":"ok"}.
```

Answer the questions, confirm delivery, then:

```sh
git -C ~/dry-run/cli-gitlab/app branch --show-current
```

```sh
git --git-dir ~/dry-run/cli-gitlab/.dry-run/origin.git branch --list 'NO-TICKET/*'
```

**Expected:** at O9 `cw pr command` prints `git -C app push origin NO-TICKET/feature/<slug>` and `glab mr create -R https://gitlab.example.com/acme/dry-run -s NO-TICKET/feature/<slug> -b main -t '<title>' --description-file <…/pr-body.md> -y`. The stub prints `https://gitlab.example.com/acme/dry-run/-/merge_requests/1`, which `cw pr record --url` records. `app/` is back on `main`, and the branch is in the bare origin.

- [ ] Record (CLI ____): printed commands, verbatim: ____ · `app/` on main: yes / no

Quit Claude Code (`/exit`).

## 5. CLI, worktree mode (`~/dry-run/cli-worktree`)

### 5.1 Prepare the project

**Steps**

```sh
node ~/Projects/claude-dev-workflow/tests/dry-run/make-project.mjs ~/dry-run/cli-worktree --mode worktree --host github
```

```sh
cd ~/dry-run/cli-worktree
```

```sh
npm install
```

```sh
git add package-lock.json
```

```sh
git commit -m '[TASK] Add the npm lockfile'
```

```sh
git push origin main
```

```sh
node ~/Projects/claude-dev-workflow/plugins/dev-workflow/cli/cw.mjs checks
```

```sh
grep -n -A6 '"worktree"' .claude/settings.json
```

**Expected:** `cw checks` passes; `.claude/settings.json` has `worktree.baseRef: "head"` and `symlinkDirectories` with `node_modules`, `packages/api/node_modules` and `packages/web/node_modules`, no `git -C app` allow rules (worktree mode has no app root), and the reviewer's read-only `Bash(git -C .claude/worktrees/* status|diff|log|show … *)` rules.

- [ ] Record: prepared: yes / no: ____

### 5.2 Start, and a session without the command

**Steps**

```sh
~/dry-run/cli-worktree/.dry-run/start-cli.sh --permission-mode manual
```

Trust the folder, then turn the sandbox on with **regular permissions** as in 3.2:

```text
/sandbox
```

```text
In packages/web/src/App.tsx change the paragraph to "Wähle ein Auto." and then show me the changed line.
```

```sh
git -C ~/dry-run/cli-worktree checkout -- packages/web/src/App.tsx
```

```text
/clear
```

**Expected:** an ordinary edit, as in 3.3.

- [ ] Record (CLI ____): normal / differs: ____

### 5.3 Task: an S task end to end in a worktree agent

**Steps**

1. Start the task:

   ```text
   /dev-workflow:ticket NO-TICKET Show the line "Alle Preise inklusive MwSt." below the intro paragraph on the web page.
   ```

2. Watch the Agent call, the implementer's git commands, its `cw commit msg` and `cw report save` heredocs, any `(cd <package dir> && …)` subshell, and `cw prove`. Note every command the harness refuses, with its message.
3. At the delivery question, run the same Edit/Write check as in 3.4 step 4 (with its fallback), then confirm delivery.
4. After the final report, run the Edit/Write prompt of 3.4 step 6 again. Then:

   ```sh
   git -C ~/dry-run/cli-worktree worktree list
   ```

   ```sh
   git -C ~/dry-run/cli-worktree branch --list 'worktree-agent-*'
   ```

   ```sh
   git -C ~/dry-run/cli-worktree branch --show-current
   ```

   ```sh
   git --git-dir ~/dry-run/cli-worktree/.dry-run/origin.git branch --list 'NO-TICKET/*'
   ```

   ```sh
   git -C ~/dry-run/cli-worktree checkout -- README.md
   ```

   ```sh
   rm ~/dry-run/cli-worktree/guard-check.md
   ```

**Expected**

- O6: the Agent call has `isolation: "worktree"` (G-AGENT-PARAMS refuses an implementer call without it in worktree mode). Claude Code creates `.claude/worktrees/agent-<id>` on `worktree-agent-<id>` from the local HEAD (`baseRef: head`, S4), with `node_modules` symlinked; it does not try to fetch the github.com origin.
- `cw ws setup` creates the task branch with `git switch -c` (no rename). The implementer runs plain `git` in its worktree: no `git -C`, and no shell variables, env prefixes or `$(…)` around git, `cw` or `node --test` (D5, implementer playbook).
- U3: the implementer commits with `git commit -F <absolute path>`, the message file `cw commit msg` wrote to `~/dry-run/cli-worktree/.git/dev-workflow/tasks/<task id>/commit-msg.txt`, outside its worktree. The harness lets the commit through, and no permission prompt appears for it: the implementer writes no file under `.git` itself. If the harness refuses, record its message and what the implementer did instead. (Observed while the kit was built: a worktree-isolated workflow subagent in the Desktop app, engine 2.1.299, committed with `git commit -F` and a message file outside its worktree; a plugin agent started with `isolation: "worktree"` was not tested.)
- The heredocs of `cw commit msg --body-file -` and `cw report save` and a `(cd <package dir> && <single-test command>)` subshell pass the harness. (Observed in the same kind of subagent: the harness refused a heredoc to an interpreter whose text named git; a heredoc to `cw` was not tested.)
- U4: `cw prove` in the worktree agent records a proof that holds, without EPERM; its temporary worktree is gone afterwards.
- G-ORCH-EDIT refuses Edit and Write during the task, with the deny reason in the transcript, and allows them after `cw task end`.
- O9: `cw pr command` prints a push of the task branch from the task's worktree and `gh pr create --repo github.com/acme/dry-run -B main -H NO-TICKET/feature/<slug> -t '<title>' -F <…/pr-body.md>`.
- Every Edit and Write of the implementer in its worktree asks, with the extra option to allow edits in `.claude` for the session: Claude Code puts the worktree under `.claude/worktrees/`, a protected path (observed in the P3 dry run, CLI 2.1.308). Answer each with Yes and record the count.
- The reviewer runs git as `git -C .claude/worktrees/agent-<id> …` (relative, as its brief prints it), without a prompt.
- Under the sandbox, `cw task cleanup` may stop with exit 3: git deleted the worktree directory but may not delete its record in `.git/worktrees`. The fix it prints (run it again outside the sandbox, or `git worktree prune`) finishes the cleanup; record which one the orchestrator used.
- O10: `cw task cleanup` removes the clean worktree and deletes `worktree-agent-<id>`. Step 4 shows one worktree (the main checkout, on `main`), no `worktree-agent-*` branch, and the task branch in the bare origin.

- [ ] Record (CLI ____): end to end pass / fail: ____ · complexity ____ · review rounds ____
- [ ] Record: U3 `git commit -F <absolute path>` in the worktree agent: passed / refused: ____ · permission prompt for the commit: none / ____
- [ ] Record: harness refusals in the worktree agent (command, message): none / ____
- [ ] Record: U4 prove under the sandbox in the worktree agent: ok / EPERM / other: ____
- [ ] Record: G-ORCH-EDIT during the task / after the end: ____
- [ ] Record: printed push and PR commands, verbatim: ____
- [ ] Record: after cleanup: worktrees ____ · `worktree-agent-*` branches ____ · fetch attempts seen: yes / no

Quit Claude Code (`/exit`).

## 6. Desktop app (`~/dry-run/desktop`)

The Desktop app shows no trust dialog and ignores a committed `extraKnownMarketplaces` in an untrusted repository, but it loads the plugins once `claude plugin marketplace add` and `claude plugin install` ran from the CLI (Appendix A; S2 and S5, Desktop 2.1.299). In the P0 spike a plugin from a directory marketplace loaded in place, with `CLAUDE_PLUGIN_ROOT` pointing at the directory (observation, Desktop 2.1.299), so a new session picks up changes in the checkout.

The Desktop app takes PATH from your shell profile (code.claude.com/docs/en/desktop), so it uses your real gh and glab, not the stubs (K5). The project therefore gets a GitLab origin under the reserved `example.com` domain, and you never confirm a push or a create command here: delivery always ends without a PR/MR. Of the dry run's own commands, only that real glab may reach the network here: `cw pr command` has it look for an existing MR on `gitlab.example.com`.

### 6.1 Prepare the project

**Steps**

```sh
node ~/Projects/claude-dev-workflow/tests/dry-run/make-project.mjs ~/dry-run/desktop --mode in-place --host gitlab
```

```sh
cd ~/dry-run/desktop/app
```

```sh
npm install
```

```sh
git add package-lock.json
```

```sh
git commit -m '[TASK] Add the npm lockfile'
```

```sh
git push origin main
```

```sh
cd ~/dry-run/desktop
```

```sh
node ~/Projects/claude-dev-workflow/plugins/dev-workflow/cli/cw.mjs checks
```

**Expected:** as in 3.1.

- [ ] Record: prepared: yes / no: ____

### 6.2 Install the plugin for the Desktop app

**Steps**

```sh
cd ~/dry-run/desktop
```

```sh
claude plugin marketplace add ~/Projects/claude-dev-workflow --scope project
```

```sh
claude plugin install dev-workflow@remklov --scope project
```

```sh
claude plugin list
```

```sh
git -C ~/dry-run/desktop diff --stat
```

```sh
git -C ~/dry-run/desktop commit -q -am '[TASK] Enable dev-workflow for the Desktop app'
```

**Expected:** both commands exit 0; `claude plugin list` shows `dev-workflow@remklov` in project scope; the diff touches only `.claude/settings.json`, which now declares the marketplace in `extraKnownMarketplaces` and enables the plugin in `enabledPlugins` (the first add and install reorder its keys once, S6).

- [ ] Record (CLI ____): installed: yes / no: ____

### 6.3 Open the project, and a session without the command

**Steps**

1. In the Desktop app open the **Code** tab, choose the folder `~/dry-run/desktop`, leave **Worktree** off (the in-place project is not a worktree session), and start a local session in your usual permission mode, not Auto.
2. Then:

   ```text
   Run these with the Bash tool and show me the output: echo "$CLAUDE_CODE_EXECPATH"; command -v cw; command -v glab
   ```

   Before you type anything else in the session, read in your terminal what the session start's quick check found (the SessionStart hook writes it; it says nothing in the session when every check passes):

   ```sh
   grep -o 'Node [0-9.]* (needs[^"]*' ~/dry-run/desktop/.git/dev-workflow/doctor-cache.json
   ```

   ```text
   In app/packages/web/src/App.tsx change the paragraph to "Wähle ein Auto." and then show me the changed line.
   ```

   ```sh
   git -C ~/dry-run/desktop/app checkout -- packages/web/src/App.tsx
   ```

3. The guards, as in 3.3 step 3:

   ```text
   Run exactly this with the Bash tool: git -C app push --force origin main
   ```

   ```text
   Call the Agent tool with subagent_type "Explore", model "haiku" and the prompt "Reply with OK".
   ```

   If it answers without calling the tool, reply `Call the tool anyway; this dry run checks the hook's refusal.`

**Expected**

- `CLAUDE_CODE_EXECPATH` contains the engine version (this is how P0 read it); `cw` resolves to the plugin's `bin/cw`.
- `glab` is your real glab (or none), not the stub, when you launched the app from the Dock or Finder. If it is the stub after all, record that.
- The session start shows no dev-workflow message: the SessionStart hook is silent when every quick check passes (observed in the P3 dry run, Desktop 3.1623.1, engine 2.1.304). `doctor-cache.json` names Node 20 or later: the hooks run with `"command": "node"` from the app's PATH, and the quick check records the Node version of the hook process.
- The edit is an ordinary edit, as in 3.3.
- Step 3: G-FORCE refuses the Bash call and G-AGENT-PARAMS (or the settings deny rule) the Agent call, each with its reason, as in 3.3.

- [ ] Record: Desktop app ____, engine ____ · glab = ____ · hook Node ____ · session without the command: normal / differs: ____
- [ ] Record: G-FORCE deny on Bash: yes / no / not checked · G-AGENT-PARAMS deny on Agent: hook reason / settings deny / not checked

### 6.4 Task D1: blocked, SendMessage, a second review round and a SubagentStop block

The SubagentStop gate blocks a workflow agent that stops without a new valid report for its round (§9). To get one block on purpose, your answer to the blocked report asks the implementer to stop once before it saves. The same answer provokes the second review round, as in 3.5.

**Steps**

1. Start a new session in the same folder and mode, then:

   ```text
   /dev-workflow:ticket NO-TICKET Add POST /api/rentals. It takes {"vehicleId": string, "days": integer from 1 to 30} and answers 201 with {"vehicleId", "days", "total"}, where total is the vehicle's pricePerDay times days. An invalid body answers 400 with {"error": "<message>"}. Validate the body with the zod library.
   ```

2. The orchestrator asks in O2 whether zod may be added (a library named in the request is not yet approved). Answer `Yes, add zod to the api package.`, so that the implementer reports `blocked` when it finds zod missing; do not install zod when the orchestrator asks you to.
3. When it brings you the blocked report, answer:

   ```text
   No new dependency: validate the body by hand, without zod. Pass this on to the implementer as well: first reply with only the word ACK and end your turn without saving a report; after that, continue the task as usual, but for this dry run write no test for the 400 answer in this round; the review is to ask for it.
   ```

4. Watch the review rounds as in 3.5 step 5.
5. At the delivery question, answer:

   ```text
   Not yet: also return "currency": "EUR" in the 201 response.
   ```

6. At the next delivery question, or when `cw pr command` stops because glab cannot reach `gitlab.example.com` (or needs a login), answer:

   ```text
   Not now. End delivery without a PR: this is a dry run in the Desktop app.
   ```

7. Check:

   ```sh
   ls ~/dry-run/desktop/.git/dev-workflow/tasks/
   ```

   ```sh
   grep -n -A3 stopBlocks ~/dry-run/desktop/.git/dev-workflow/tasks/<task id>/task.json
   ```

   ```sh
   grep -n blocked ~/dry-run/desktop/.git/dev-workflow/hooks.log
   ```

   ```sh
   grep -n 'review round' ~/dry-run/desktop/.git/dev-workflow/tasks/<task id>/task.json
   ```

   ```sh
   git -C ~/dry-run/desktop/app branch --show-current
   ```

**Expected**

- `/dev-workflow:ticket` starts from the Desktop prompt with its arguments.
- The implementer reports `blocked`; the orchestrator asks you and sends your answer with SendMessage to the same implementer, as in 3.5. U1 as in 3.5.
- The implementer's `cw context` prints no `Note:` line and its git commands run as `git -C app …` without a prompt: the Desktop subagent's Bash cwd is the project root, as in the CLI. No permission prompt appears for the commit.
- In the Desktop app the agents hand their reports back through `SubagentHandback` (S7), so the orchestrator reads them with `cw report show` and `cw review show`, never from the Agent result.
- Step 3: the implementer replies ACK and stops; the SubagentStop gate blocks it (the reason names `cw report save --task <id>` and the JSON fence to end with), and the agent continues and saves its report. In the Desktop app SubagentStop has no `last_assistant_message`, so the gate decides from the saved report file alone. `task.json` counts the block in `stopBlocks` under the implementer's agent id (`"<agent id>": 1`), and `hooks.log` has the line `blocked implementer <agent id> of <task id> (1/2): …`. The implementer may follow your ACK request once more: then the count is 2, `hooks.log` adds `(2/2)` and `let implementer … stop after 2 blocks`, and the orchestrator continues it with a SendMessage (observed in the P3 dry run). If the implementer ignores the ACK request, record that and repeat the request in your answer at step 5.
- Step 4: `Review round 1/3: changes_requested` for the missing 400 test, then `cw task return`, SendMessage to the same implementer, `cw task review` with a SendMessage to the same reviewer, and `Review round 2/3`, as in 3.5. If it is not reached, record why; the item stays open.
- Step 5: a new cycle (`Review round 1/3`) with SendMessages to the same implementer and reviewer, as in 3.5 step 6.
- Step 6: no push and no create command runs; `cw pr record --skipped "<reason>"`, `cw task cleanup`, `cw task end --outcome done`; `app/` is back on `main`.

- [ ] Record (Desktop ____, engine ____): `/dev-workflow:ticket` from the Desktop prompt: yes / no · blocked → SendMessage → new report: pass / fail: ____
- [ ] Record: U1 SendMessage waits for the next report: yes / no: ____
- [ ] Record: `cw context` Note: none / ____ · `git -C app` without prompt: yes / no · permission prompt for the commit: none / ____
- [ ] Record: `Review round 2/3` after changes_requested: yes / no · same reviewer: yes / no · spec change gave `Review round 1/3`: yes / no
- [ ] Record: SubagentStop block: yes / no · reason shown: ____ · `stopBlocks` entry: ____ · hooks.log line: ____ · the agent continued and saved: yes / no
- [ ] Record: reports read with `cw report show` / `cw review show`: yes / no
- [ ] Record: delivery: skipped, nothing pushed: yes / no: ____

### 6.5 Task D2: auto mode

The Desktop app's auto-mode classifier refused P0 spike calls whose instructions came from another session, and an Agent call whose prompt asked for a "token" (Appendix D). In auto mode "the first time Claude uses the Read, Grep, or Glob tool on a path outside [the working directories], Claude Code asks whether to allow that read" (code.claude.com/docs/en/permission-modes), so the first read of a ticket step file in the plugin directory may ask once.

**Steps**

1. Switch the permission mode to **Auto** (the mode selector under the prompt box, or Cmd+Shift+M) and start a new session in `~/dry-run/desktop`.
2. Then:

   ```text
   /dev-workflow:ticket NO-TICKET Add GET /api/health to the API; it answers 200 with {"status":"ok"}.
   ```

3. At the delivery question, run the Edit/Write check of 3.4 step 4 with its fallback (a hook deny applies in every mode), then answer as in 6.4 step 6.
4. Check:

   ```sh
   git -C ~/dry-run/desktop/app branch --show-current
   ```

**Expected:** the task runs end to end in auto mode: the classifier lets the workflow's Bash and Agent calls through, including the implementer's `git -C app commit -F <file>` (P3-D), the guards still refuse Edit and Write during the task, nothing is pushed, and `app/` ends on `main`. A prompt for the first read of a step file is expected at most once.

- [ ] Record (Desktop ____, engine ____): auto mode end to end: pass / fail · classifier refusals (call, reason): ____ · `git -C app commit -F`: allowed / asked / refused · read prompts outside the project: ____

### 6.6 Remove the plugin

**Steps**

```sh
cd ~/dry-run/desktop
```

```sh
claude plugin uninstall dev-workflow@remklov --scope project
```

```sh
claude plugin marketplace remove remklov
```

```sh
claude plugin marketplace list
```

```sh
claude plugin list
```

**Expected:** neither `remklov` nor `dev-workflow` is listed (`marketplace remove` without `--scope` removes the declaration from every scope, `claude plugin marketplace help remove`, CLI 2.1.303).

- [ ] Record (CLI ____): removed: yes / no: ____

## 7. Clean up

After you recorded everything, archive the Desktop sessions of `~/dry-run/desktop` in the app, then delete the projects:

```sh
rm -rf ~/dry-run
```

The dry run also leaves a few things outside `~/dry-run`. Check each and undo what you do not want to keep:

- **The global gitignore entry** for `.claude/settings.local.json`, which Claude Code adds when `/sandbox` saves a setting (code.claude.com/docs/en/sandboxing). It is useful in every project; remove it only if you do not want it. Your global gitignore is the file `git config --global core.excludesfile` names, or `~/.config/git/ignore` when that is unset:

  ```sh
  git config --global core.excludesfile
  ```

- **`sandbox.network.allowLocalBinding`** in `~/.claude/settings.json`, if you added it in 1.3 only for the dry run: remove the key there.
- **Per-project records of the dry-run folders**, such as the folder trust of the CLI runs and the session transcripts. Claude Code keeps user-level state in `~/.claude.json` (Appendix A, S6) and transcripts under `~/.claude/projects/` (observation on this Mac); where exactly the trust is kept is not documented, and neither file is documented as a format to edit. Leave them (they point at folders that no longer exist), or remove the `~/dry-run/…` entries with Claude Code closed.
- **The plugin cache** of the Desktop install: cached plugin versions are not pruned (Appendix B). `claude plugin list` shows nothing after 6.6; leftover directories under `~/.claude/plugins/` can stay.

- [ ] Record: removed / kept outside `~/dry-run`: ____

## 8. What the kit assumes

These were not verifiable when the kit was built (no npm install, no network, no Claude Code session); the named steps confirm them.

| Assumption | Confirmed by |
|---|---|
| K1: the dependency ranges in the generated `package.json` files resolve, and `npm install` succeeds | 3.1 |
| K2: `npm test`, `npm run lint` and `npm run typecheck` pass in each workspace package with the hoisted `node_modules/.bin`, including Vitest resolving `./app.js` to `app.ts`, `return res.json(…)` with the Express 5 types, and the ESLint flat config with typescript-eslint | 3.1 (`cw checks`) |
| K3: the sandboxed API test passes once `allowLocalBinding` is set | 1.3, 3.4 |
| K4: the PATH that `start-cli.sh` sets reaches the Bash tool's commands, so `gh` and `glab` resolve to the stubs (the plugin's `bin/` comes after your own PATH, Appendix A); 3.2 says what to do when it does not | 3.2, 4.1 |
| K5: the Desktop app does not see the stubs (PATH from the shell profile) | 6.3 |
| K6: a sandboxed push into `<project>/.dry-run/origin.git` is allowed: it is inside the working directory, and the sandbox's bare-repository protection covers `HEAD`, `objects` and `refs` at the top level only (code.claude.com/docs/en/sandboxing) | 3.4 |
| K7: creating the agent worktree with `baseRef: head` does not fetch the origin, so the github.com fetch URL is never contacted | 5.3 |
| K8: the directory marketplace loads the plugin from the checkout in place in the Desktop app | 6.2, 6.4 |
| K9: no real GitLab answers for `gitlab.example.com`, so the real glab of the Desktop app finds no MR there and creates nothing | 6.4, 6.5 |
