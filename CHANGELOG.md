# Changelog

All notable changes to the plugins of this marketplace. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each plugin has its own [semantic version](https://semver.org/) in its `plugin.json`, so a release gets a `## <plugin> <version> - YYYY-MM-DD` section, and every `Unreleased` entry names its plugin.

## [Unreleased]

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
