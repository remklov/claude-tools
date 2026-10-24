# Playbooks

Every role of the dev workflow works from a fixed playbook (requirement R3 in `docs/PLAN.md`), so the way of working is as deterministic as a model allows. A playbook is five things:

1. **The role skill**: fixed steps, each naming the `cw` command that does its mechanical part.
2. **Procedures** from the active packs and the project, selected per task and inlined into the agent's brief.
3. **Scripts**: the `cw` commands, plus pack scripts through `cw run <pack>:<script>`.
4. **The output contract**: JSON that `cw report save` or `cw review save` validates, and that the SubagentStop hook requires before an agent may end.
5. **Guards**: PreToolUse hooks that refuse the few actions a role must never take (PLAN §9).

`cw playbook show <orchestrator|implementer|reviewer> [--task <id>]` prints a role's set: its skill, its commands with usage, the procedures (selected for the task with `--task`), the pack scripts, the output contract and the guarded commands.

| Role | Skill | Runs as | Loaded |
|---|---|---|---|
| Orchestrator | `skills/ticket/` | the main session, while a task is active | by the user: `/dev-workflow:ticket <TICKET-KEY \| NO-TICKET> [notes]` |
| Implementer | `skills/implementer-playbook/` | the agents `implementer-s`, `-m`, `-l`, `-xl` | preloaded through the agents' `skills:` field |
| Reviewer | `skills/reviewer-playbook/` | the agent `reviewer` (read-only; Write only for its review file outside the project) | preloaded through the agent's `skills:` field |

Two more skills serve the user: `/dev-workflow:status` summarizes the tasks (`cw task list`, `cw task show`), and `/dev-workflow:doctor` runs `cw doctor --fresh` and explains each finding.

## How the skills are loaded

- `ticket` sets `disable-model-invocation: true`: only the user starts the workflow, so a session without the command stays a normal session (D2). Its description is then not in Claude's context (documented, code.claude.com/docs/en/skills, "Invocation control").
- `implementer-playbook` and `reviewer-playbook` set `user-invocable: false` and never `disable-model-invocation`: a skill with `disable-model-invocation: true` is not preloaded into subagents (documented in the skills frontmatter reference; spike S1 confirmed it). A preloaded skill's full content is injected when the agent starts, so these two skills keep everything an agent needs in `SKILL.md`.
- The `ticket` skill keeps its ground rules and the step overview in `SKILL.md` and the details in `steps/o1-intake.md` … `steps/o10-close.md` and `reference/{spec,jira,linear,local,recovery}.md`, which the orchestrator reads when it enters a step, with `cw playbook read <file>`: the Read tool asks before a file outside the project (documented, code.claude.com/docs/en/permissions), and `Bash(cw *)` is allowed.
- After a compaction Claude Code re-attaches the first 5,000 tokens of an invoked skill (documented), so the ground rules come first in `ticket/SKILL.md`, and the skill tells the orchestrator to find its place again with `cw task list` and `cw task show`.
- Budgets, checked by `tools/repo-lint.mjs` and `tests/unit/skills.test.mjs`: `SKILL.md` ≤ 200 lines, a step file ≤ 80, a reference file ≤ 150.
- `tests/unit/skills.test.mjs` also checks every `cw` line of the skills: the command and its flags against the registry, and the whole line through cw's own `main()` against a fixture task, with the placeholders filled and the task tried in each phase. A missing required flag or a refused combination (exit 2) fails the test; a snippet that names only the command (`cw context`) is a mention and is not run.

## Orchestrator (`/dev-workflow:ticket`)

The main session becomes the orchestrator of one task until `cw task end`. Its ground rules:

- It never edits the project's files; the guard G-ORCH-EDIT refuses Edit, Write and NotebookEdit of project files in the session that owns an active task. The ticket snapshot, the spec and a corrected PR/MR body reach `cw` on stdin from a file it writes into its scratchpad directory (a heredoc with JSON makes Claude Code ask).
- It never uses `cd` (guard G-CD): absolute paths, and git in the form `cw` prints (in in-place mode `git -C <appRoot> …` relative to the project root).
- It delegates with exactly what `cw` prints: the Agent call's `subagent_type`, `description`, `prompt`, `run_in_background: false` (where the Agent tool has that parameter), and `isolation` only when printed; never `model` or `effort` (guard G-AGENT-PARAMS). It waits for every agent, its own Explore calls in O1 included: where the Agent tool has no `run_in_background` (the interactive CLI and the Desktop app), agents run in the background, and it runs nothing for the task until the report arrives as a message (PLAN Appendix A). It sends SendMessages only to the same agent and only when `cw` names one; `cw task return` prints a fresh Agent call instead when the implementer's context is larger than `workflow.freshImplementerAboveTokens`.
- It reads reports and reviews only with `cw report show` and `cw review show` (D4).
- The user decides through AskUserQuestion: clarifications (at most `workflow.maxQuestionsPerRound` per round), the confirmation of large classifications, every decision `cw` hands over, and every push, naming exactly what is pushed (D7).

| Step | What | `cw` commands |
|---|---|---|
| O1 Intake | Setup check, active task of the ticket (rebind after the user agreed, D3; the output names the phase and the next command, and the step follows from the phase), one ticket read from the source of `tickets.source` and its context file (D6, ADR 0009), the kickoff plan, Explore (waiting for its result) | `doctor --quick`, `task list --ticket`, `task new --rebind` |
| O2 Clarify | Questions until every acceptance criterion is testable; a check only a person can do becomes a manual check in the Definition of done | – |
| O3 Spec | Task, ticket snapshot, spec, lint | `task new`, `ticket save`, `spec save`, `spec lint` |
| O4 Classify | Packages, areas, minimum; the chosen level with a reason | `classify`, `classify --set --why [--override]` |
| O5 Confirm | For the levels in `workflow.confirm` | `task confirm --note` |
| O6 Delegate | The implementer Agent call, its id recorded | `task start`, `task agent --role implementer` |
| O7 Report | done → O8; blocked → answer; misclassified → reclassify and reset | `report show`, `classify`, `task reset [--keep --note]`, `task start --new-agent` |
| O8 Review loop | Foreign commits, review rounds, findings back, escalation | `git foreign-commits`, `task review`, `review show`, `task return [--spec-changed \| --continue] [--new-agent]` |
| O9 Deliver | Body, commands, confirmation, push and PR/MR, record | `pr body [--stdin]`, `pr command`, `pr title`, `pr record --url \| --skipped` |
| O10 Close | Work tree back, task ended, short report | `task cleanup`, `task end --outcome` |

**Acceptance criteria are always testable** (O2). A check only a person can do, such as a visual detail in a browser, is never an acceptance criterion: the spec lists it under Definition of done as `Manual check: …`, the implementer writes no test for it and lists it as an open point with tag `manual`, the reviewer raises no finding for it, and the PR/MR body names it as not verified. The ticket skill (O2, `reference/spec.md`), the implementer playbook (step 3) and the reviewer playbook (R3) say the same.

The misclassified reset (`cw task reset`) removes an implementer's empty start (a clean branch without commits) and refuses anything else (exit 3); the user then decides between `--keep --note "<decision>"`, which continues the branch with the new level, and cleaning up by hand. A spec change is possible in spec, classify and confirm, while a report is blocked, after an approval and after an escalation; after an approval or an escalation it restarts the implementer and review cycle with `cw task return --spec-changed`.

## Implementer (`implementer-playbook`)

| Step | What | `cw` |
|---|---|---|
| 1 | Create or switch to the task branch; a refusal is reported as blocked | `ws setup` |
| 2 | Read the brief, then the context (work tree, git form, packages, rules) and the code | `context`, `rules show` |
| 3 | Tests first: at least one per acceptance criterion, a regression test for a bug fix; manual checks need none | `step --done 3` |
| 4 | Implement within scope; no dependency changes | `step --done 4` |
| 5 | Checks of every changed package until they pass; never loosen a check | `checks --changed` |
| 6 | Stage, message file (body on stdin, attribution lines as trailers), `git commit -F` in the printed git form, convention check | `commit msg [--body-file -] [--trailer]`, `commit lint` |
| 7 | Prove each new test fails without the change and passes with it | `prove --test --change` |
| 8 | Report written into the scratchpad, on stdin to `cw`; the final message is exactly the printed JSON fence | `report save` |

- **Report** (`schemas/dev-report.schema.json`): `status` (done, blocked, misclassified), `acceptanceCriteria` (id, met, evidence), `risks`, `openPoints` (text, optional tag manual, follow-up, risk, question), `blocked` (question, needed), `misclassified` (reason, suggested level), and the required `handover` (decisions, rejected, testing, pitfalls, deviations: short notes for a fresh implementer, [ADR 0012](adr/0012-fresh-implementer-above-context.md)); a done report fills at least one of them. `cw` adds the commits, the checks result and the proofs, and refuses a done report whose state does not hold.
- **Blocked** for an ambiguous criterion, a needed dependency, a refused setup, unowned files or a conflict with a protected rule. **Misclassified** when the task needs more than the complexity's guardrails allow; the implementer stops before it expands the scope.
- **Review findings** come by message: every blocking finding and every one marked "also" (`sendAlong`) is fixed, then steps 5 to 8 run again.
- **Guardrails** by complexity, from `cli/lib/guardrails.mjs` (the agents and the briefs share the text): s keeps the diff to 1–2 files without behaviour or contract changes; m stays within one module, additive and backward-compatible; l lists every changed contract and its callers and updates them in the same change; xl investigates first and justifies the smallest change, naming security, concurrency and data-integrity implications.
- **`--task <id>`** on every `cw` command that takes it: all of the implementer's except `cw rules show <ID>`, which refuses it.
- **Nothing under `.git`.** The implementer never writes or edits a file under `.git`: Claude Code treats `.git` as a protected path, where a write is prompted in the default and acceptEdits modes, routed to the classifier in auto mode and denied in dontAsk, and "`permissions.allow` rules in settings files do not pre-approve protected-path writes" (code.claude.com/docs/en/permission-modes). The commit body therefore goes to `cw commit msg --body-file -` on stdin, and attribution lines its instructions require go in with `--trailer "<line>"`; `cw` writes the message file itself.
- **Git form.** In-place: `git -C <appRoot> …` exactly as `cw context` prints it, from the project root; a `Note:` in `cw context` means the Bash cwd is elsewhere, and the implementer follows the note or reports blocked. Worktree mode: plain `git` in the agent's worktree, and git and the tools that run git (`cw`, `node --test`) without shell variables, env prefixes or command substitution around them. Observation (worktree-isolated subagents in the Desktop app, engine 2.1.299): the harness refused `env -u … VAR=… node …`, `sed -n … $f`, `S=…; sh $S/…`, a heredoc to an interpreter whose text named git, and `perl -e '… exec @ARGV' node …`; it allowed `sh <literal path> <literal args>`, `node --test …` that spawns git, and `git commit -F <absolute path outside the worktree>`.
- **The stop check.** The SubagentStop hook holds the implementer (at most twice) until `cw report save` succeeded for the round after the agent's current turn began. A report saved before the orchestrator's last `cw report show` does not count, so an agent continued with SendMessage saves again.
- **Step marks** for the progress display: `ws setup`, `context`, a passing `checks`, a clean `commit lint`, a holding `prove` and `report save` mark their steps; the agent marks 3, 4 and (without a new test) 7 with `cw step`.

## Reviewer (`reviewer-playbook`, read-only)

| Step | What | `cw` |
|---|---|---|
| R1 | Scope: diff stat, unowned files, foreign commits, uncommitted changes and added `node_modules` paths (blocking), non-goal hints, pack scope scripts (blocking unless a non-blocking `scope` finding names the script and says why it is accepted) | `review scope` |
| R2 | The checks in the task's work tree; a failing check is blocking | `checks --changed` |
| R3 | Every acceptance criterion with named evidence; the recorded proofs re-run; a criterion without a test, or a test that does not fail without the change, is a blocking CORE-TEST-SPEC finding; a manual check of the Definition of done needs no test and is no finding | `prove --recheck` |
| R4 | Each applicable rule checked; `rulesChecked` equals that set | `rules applicable` |
| R5 | The reviewer procedures from the brief | `run <pack>:<script>` where a procedure names one |
| R6 | Correctness and security beyond the rules | – |
| R7 | Branch name and commits against the git preset | `commit lint` |
| R8 | The review written into the scratchpad, on stdin to `cw`; the final message is exactly the printed JSON fence | `review save` |

- **Review** (`schemas/review.schema.json`): `status` (approved, changes_requested), `acceptanceCriteria`, `rulesChecked`, `findings` (id, severity blocking or non_blocking, rule: a checked rule ID or spec, scope, git, correctness, security; file, line, issue, suggestion, `sendAlong`), `summary`.
- `cw review save` refuses an approval without current passing checks for every changed package, without a proof recheck at the reviewed head after the report, with missing or extra rules, with scope problems, or for a bug fix without a holding regression proof.
- A style preference without a rule is never blocking. Cheap non-blocking findings carry `sendAlong`, so the implementer fixes them together with the blocking ones.
- The stop check holds the reviewer the same way until `cw review save` succeeded for the round; in a later round, continued with SendMessage, it saves a new review.

## Procedures

A procedure is a short Markdown checklist for one role and one kind of change, for example `express:express-route` (implementer) or `react-vite:ui-review` (reviewer).

**Where they live:** `packs/<id>/procedures/<role>/*.md` in the plugin, and `.claude/dev-workflow/procedures/<role>/*.md` in the project. The role directory is `orchestrator`, `implementer` or `reviewer`.

**Frontmatter:**

```markdown
---
name: express-route
role: implementer
description: Add or change an Express route with validation, error responses and HTTP tests.
when:
  keywords: [route, endpoint, api, handler, middleware, request]
  areas: [backend]
scripts: []
rules: [EXPRESS-ASYNC-ERRORS, EXPRESS-INPUT-VALIDATION]
---
1. Find where routes are registered for `{options.appEntry}` …
```

- `name`: lowercase words joined by hyphens; `role`: the directory the file is in; `description`: one line.
- `when`: `paths` (globs), `areas`, `keywords`, and for orchestrator procedures `phases`.
- `scripts`: pack scripts the steps run (`<pack>:<script>`); `rules`: rule IDs the procedure applies.
- The body is numbered steps. Pack options and project values (`{options.x}`, `{project.language.repo}`) are filled in; an unresolved placeholder is a load error.

**Selection** (`cli/lib/packs.mjs`, `selectProcedures`) is deterministic: the same task gives the same procedures.

1. Load: the active packs in layer order, then the project; files in name order within a role. A project procedure with the same role and name replaces the pack's in place (with a warning); any other duplicate is an error.
2. Filter by role.
3. A procedure with an empty `when` always applies. Otherwise one trigger is enough:
   - `paths`: a glob matches one of the task's files. For the implementer these are the spec's Context paths plus the files changed so far; for the reviewer the changed files.
   - `areas`: one of the task's areas from `cw classify`.
   - `keywords`: the word appears in the spec's title or requirements, as a whole word, case-insensitive.
   - `phases`: the task's phase (orchestrator procedures only).
4. `cw task start`, `cw task review` and `cw task return` inline the full text of the selected implementer or reviewer procedures into the brief, rendered before the task changes phase, so a broken procedure file leaves the task where it was. The orchestrator sees its procedures with `cw playbook show orchestrator --task <id>`.

## Scripts

- `cw run <pack>:<script> [--task <id>] [--base <ref>] [-- <args>]` runs a pack script in the task's work tree, with its output and exit code passed through.
- Pack scope scripts (`scopeScripts` in `pack.json`, such as `vitest:no-focus` and `node-npm:dependency-changes`) run in `cw review scope`; exit 1 is a finding, any other exit or a timeout means the script did not finish its check.

## Guards

The PreToolUse guards are a backstop, not a security boundary (D12). Every refusal names the alternative.

| Guard | Applies to | Refuses |
|---|---|---|
| G-ORCH-EDIT | the main session that owns an active task | Edit, Write, NotebookEdit |
| G-AGENT-PARAMS | everyone | `model` or `effort` on Agent calls; in worktree mode an implementer call without `isolation: "worktree"` |
| G-PUSH | workflow agents | `git push`, creating or merging a PR/MR |
| G-FORCE | everyone | force pushes |
| G-REVIEWER-WRITE | the reviewer | git writes, redirection, `tee` and `sed -i` into the repository |
| G-DEPS | workflow agents | dependency installs and updates |
| G-COMMANDS, G-PORTS, G-DEVSERVER | workflow agents | the config's `guards.commands`, `guards.ports`, and dev servers when `guards.devServer` is `never` |
