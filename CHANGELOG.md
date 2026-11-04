# Changelog

All notable changes to the plugins of this marketplace. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each plugin has its own [semantic version](https://semver.org/) in its `plugin.json`, so a release gets a `## <plugin> <version> - YYYY-MM-DD` section, and every `Unreleased` entry names its plugin.

## [Unreleased]

## dev-workflow 0.9.0 - 2026-11-04

### Added

- `cw ticket context` (O1) and `cw task start` fetch `origin` and fast-forward the base branch before the spec reads the code and before the task branch starts from it. The update uses `git merge --ff-only` where the work repo has the branch checked out, and moves the ref where nothing has it checked out. Local commits, a diverged branch, a checkout in another worktree, local changes the update would overwrite and a failed fetch leave the branch as it is. They give a warning: in O1 the orchestrator asks the user whether to go on with the local base, and `cw task start` then starts from it. `git.updateBase: false` turns the update off (ADR 0021).

## dev-workflow 0.8.2 - 2026-11-02

### Changed

- The ticket skill sets `effort: high`, which Claude Code applies to the turn the skill starts: the spec phase from the ticket to the implementer's start (O1 to O6), whatever the session's effort. The orchestrator asks only with AskUserQuestion, so that phase stays one turn; later turns run at the session's effort (ADR 0020).

### Removed

- The self-implementation of 0.8.0: `workflow.selfImplement`, the orchestrator's own worktree of `cw ws setup`, the G-ORCH-EDIT opening for it and `cw commit msg --commit`. Repriced for the workflow as built, it made `s` tasks 8 % and `m` tasks 22–64 % more expensive than delegating them, because it kept the orchestrator's work and moved only the cheap Sonnet implementer into it (ADR 0019, withdrawn). A config that sets `workflow.selfImplement` must drop the key. `cw test` stays for the implementer.

## dev-workflow 0.8.0 - 2026-11-01

### Added

- `workflow.selfImplement` (default `["s"]`): the orchestrator implements a task of such a complexity itself, and the reviewer stays an agent. `cw task start` prints no Agent call then (`--agent` delegates anyway; `cw task start --new-agent` and `cw task return --new-agent` hand the work to an agent). In worktree mode `cw ws setup` adds `.claude/worktrees/self-<id>` and links `node_modules`; G-ORCH-EDIT opens that work tree, and the session gets the implementer's guards while it implements. New `cw test --task <id> --test <package>:<file>` runs one test in the work tree, and `cw commit msg --commit` stages and commits every change but `node_modules` links. The implementer playbook uses `cw test` instead of a subshell (ADR 0019).
- `cw review decide --task <id> --finding <F>[,<F>] --as fix|ticket|accept --note "<answer>"` records the user's decision on a review finding. `cw review show` marks the findings that need one: those the reviewer set `decision` on, and every non-blocking `correctness` or `security` finding. `cw task return` refuses a review that requested changes, and every `pr` command an approval, while one is undecided; after an approval `cw task return` sends the findings the user decided to fix. `cw task end` lists the ones the user wants a ticket for (ADR 0015).
- review findings take `decision` (with the recommendation in `suggestion`) and `carriedFrom` (a finding of the previous review, which `cw review save` checks); a carried-over finding keeps the user's decision (ADR 0015).
- `cw checks --task` prints rule hints from the diff: whitespace-only hunks (CORE-SCOPE), abbreviations outside the allowed list and booleans without `is`/`has`/`can`/`should` (CORE-NAMING), new module-private helpers with fewer than three references (CORE-SIMPLICITY). They are no findings and never fail the command (ADR 0017).
- `cw checks --task` reuses a recorded passing run of the same work tree content, selection and commands, and `cw prove --recheck` counts a proof recorded at the current commit without a run; `--fresh` runs either again (ADR 0018).
- `cw pr body --what <file>` puts the orchestrator's summary of the change into What & why (ADR 0014).
- the spec template has the section Risks and deploy steps, which the PR/MR's Risks & deploy steps take over; `cw spec lint` warns when it is missing. The ticket snapshot takes `comments` and `links`, and the briefs show them; the Jira read asks for the fields `comment` and `issuelinks`. `cw ticket context` lists the branches and commits that name the key (ADR 0016).

### Changed

- **Breaking for the playbooks:** agents end with the one line `cw report save` or `cw review save` prints last (`dev-workflow report <id> round <n>: <status>`) instead of the JSON fence; the SubagentStop gate reads its status and still accepts a fence (ADR 0014).
- `cw task review` after an implementer round prints the done report and checks foreign commits itself (exit 1 with the fix), so O7 and O8 need one call; every delegation's `Next:` is `cw task review` or `cw review show`. The orchestrator no longer records agents with `cw task agent`: the SubagentStart hook does, and `cw report show`, `cw task review` and `cw review show` name `cw task agent` only when none is recorded (ADR 0014).
- the PR/MR body lists at most six requirements without `--what`, the checks in one line per package, several proofs by their test files, and the open points of the final review only, with the user's decisions (ADR 0014, ADR 0015).
- the reviewer blocks a defect on a path the change touches also when it is narrow, unreachable today or behind a stub, compares the ticket with the spec and the diff, and carries over the findings of its previous review that still hold (ADR 0015, ADR 0016).
- `cw spec save` is allowed while the review requests changes, so the user's answers can change the spec before the round goes back.
- O1 asks about earlier work on the key and suggests a new session when this one ran a task; `cw task list` and `cw task end` say so. O2 asks about contradicting criteria and the operational fallout (ADR 0014, ADR 0016).

## agents-progress 0.2.0 - 2026-10-26

### Changed

- Released again under a new version, with no change since 0.1.0: an install made before the 0.1.0 release (from a pre-release commit) holds an older copy under the same version 0.1.0, without the task band, and `claude plugin update` never replaces it, because Claude Code takes the version from `plugin.json`. Updating to 0.2.0 brings every install to the released code.

## dev-workflow 0.7.0 - 2026-10-25

### Changed

- **Breaking for reports:** step 4 of the implementer playbook ends with a rules check: the implementer runs `cw rules applicable --task <id>`, checks the lines it changed against each rule, as the reviewer does, and fixes each violation before the checks. A done report lists those rule IDs as `rulesChecked`; `cw report save` refuses one whose list differs from `cw rules applicable` and names the missing and the extra rules. The saved report keeps `rulesChecked` and `rulesApplicable` (ADR 0013).
- `cw review save` names an empty `rulesChecked` as such instead of listing every missing rule.

## dev-workflow 0.6.0 - 2026-10-24

### Added

- `workflow.freshImplementerAboveTokens` (default `150000`; `0` or `null` switch it off): `cw task return` measures the implementer's context in its Claude Code transcript and, above the threshold, prints a fresh Agent call with a takeover brief instead of the SendMessage. The output names the reason in one line, the task history records the switch with the measured size, and `cw task show` prints it. An unknown size keeps the SendMessage and says so (ADR 0012).
- The SubagentStop hook records the agent's transcript path (`agent_transcript_path`).
- A fresh implementer's brief (`cw task return`, `cw task start --new-agent`) has the section "Taking over from an earlier implementer": the branch state with the commits and the changed files, and the handover, risks and open points of the last report; no diff.

### Changed

- **Breaking for reports:** every implementer report carries `handover` (`decisions`, `rejected`, `testing`, `pitfalls`, `deviations`, each at most 8 notes of at most 400 characters); `cw report save` refuses a report without it, and a done report fills at least one list.

## dev-workflow 0.5.0 - 2026-10-23

### Added

- `cw review diff`, `cw review log` (with `--rev <commit>[:<path>]`) and `cw review status`: the reviewer's read-only history of the task's work tree, in both workspace modes, without a permission prompt (ADR 0011).

### Changed

- **Security:** `cw init` no longer writes `Bash(git -C .claude/worktrees/* …)` allow rules in worktree mode: the `*` in front of the subcommand also approved git options such as `-c` or `--exec-path`. Remove existing ones from `.claude/settings.json` by hand.
- The reviewer's brief, role context and playbook name the `cw review` commands instead of a git form.

## dev-workflow 0.4.1 - 2026-10-23

### Fixed

- `cw task new` checks for an active task of the same ticket again under the state lock, so two sessions of one clone that start the same ticket at the same moment cannot both get a task.

## dev-workflow 0.4.0 - 2026-10-23

### Added

- The git preset `ticket-suffix`: branch `{ticketLower}-{slug}` (`chore-{slug}` without a ticket), commit summary `<Summary> (<TICKET>)` without keywords, flags or trailers, the PR/MR title from the oldest commit's summary.
- Presets may set `branchNoTicket`, the branch token `{ticketLower}`, and `commit.summary` / `commit.summaryNoTicket` templates; `cw commit msg` then takes no `--keyword`.
- The PR/MR section "Affected packages" (the task's packages with their paths).

## dev-workflow 0.3.0 - 2026-10-23

### Changed

- **Breaking:** `tickets.source` defaults to `local`, with the ticket files at `docs/tickets/{key}.md` (`tickets.contextPath`); a config that relied on the `jira` default must name `"source": "jira"` (ADR 0010).
- Jira is read through Atlassian's plugin `atlassian@claude-plugins-official`; `cw doctor`, setup.sh and the ticket skill name it, and `tickets.site` has no default.
- The git preset is `default` (`git.preset`), with the same conventions.
- setup.sh declares the marketplace as the github source `remklov/claude-tools` and accepts GitHub's `ssh -T` greeting.
- repo-lint reads its private list of terms from `FORBIDDEN_TERMS` or `~/.config/claude-tools/forbidden-terms` and also checks commit messages and authors (`--range`); CI runs on GitHub Actions, and `tools/install-hooks.sh` installs the same checks as git hooks.

## dev-workflow 0.2.0 - 2026-10-23

### Added

- The ticket sources `linear` (Linear's read-only MCP server in the project's `.mcp.json`) and `local` (a Markdown file per ticket) next to `jira`, chosen by `tickets.source` (ADR 0009).
- `tickets.contextPath`, a file per ticket key with technical context for Jira and Linear tickets, or the ticket itself for `local`; the snapshot and the brief name it.
- `cw ticket context --ticket <KEY>`, which prints the source and the file of a key; `cw doctor`, `cw init` and `setup.sh` follow the configured source.

### Changed

- The entry hint is `/dev-workflow:ticket <TICKET-KEY | NO-TICKET> [notes]`.

## dev-workflow 0.1.0 - 2026-10-23

### Added

- Marketplace `remklov` with the plugins `dev-workflow` and `agents-progress`.
- The implementer agents `implementer-s`, `-m`, `-l` and `-xl`, generated from one model matrix, and the read-only `reviewer` agent.
- The `cw` CLI (`bin/cw`), with the setup, orchestrator, implementer and reviewer commands of PLAN §8: task state with locks, spec lint, classification, briefs and Agent calls, checks, proofs, reports and reviews, git conventions, PR/MR text and commands, `init` and `doctor`.
- The packs `core`, `node-npm`, `typescript`, `express`, `react-vite` and `vitest` (rules, procedures, scripts), the `default` git preset, the JSON schemas and the `init` templates.
- The skills `ticket` (the orchestrator, `/dev-workflow:ticket <JIRA-KEY | NO-TICKET> [notes]`), `implementer-playbook`, `reviewer-playbook`, `status` and `doctor`, described in `docs/playbooks.md`.
- The hooks of PLAN §9: SessionStart setup check, SubagentStart agent record and role context, SubagentStop report and review gate, and the PreToolUse guard catalog.
- `cw commit msg --trailer` and `--body-file -`, and in-place git commands as `git -C <appRoot>` with matching allow rules written by `cw init`.
- `tools/generate-agents.mjs` (with `--check`) and `tools/repo-lint.mjs` (skill budgets, private terms, manifests, plugin agents).
- Text for `cw` (ticket, spec, PR/MR body, report, review) through a file in the session scratchpad and `cw … < <file>`; the reviewer may write that file outside the project.
- `cw playbook read`, through which the orchestrator reads the ticket skill's step and reference files.
- The guard G-CD against a `cd` that stays, and allow rules from `cw init` for the read-only `git -C` commands (`docs/adr/`).
- `cw commit lint` (the branch name and commits against the git preset).
- `setup.sh`: the guided setup and update of a project (SSH, marketplace, plugins, git host login, Jira, sandbox local binding, `cw init`, checks), with `tests/setup.test.sh`.
- The dry-run kit (`tests/dry-run/`) and its checklist `docs/dry-run.md`.
- Docs: `docs/setup.md`, `docs/architecture.md`, `docs/config.md`, `docs/packs.md`, `docs/extending.md` and the decision records in `docs/adr/`.

## agents-progress 0.1.0 - 2026-10-23

### Added

- The Agents pane (every subagent with costume, model, effort, round, status, context, tokens and time) and the task band (ticket, title, phase, review round, tier, step, PR/MR link), read from `cw`'s `state.json`; `/agents-progress` shows or hides the pane.
