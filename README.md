# claude-tools

Private Claude Code marketplace **`remklov`** with two plugins:

| Plugin | What it is |
|---|---|
| `dev-workflow` | Orchestrated development workflow: an orchestrator, generalist agents (`implementer-s/m/l/xl`, `reviewer`, `investigator`) with fixed role playbooks, stack packs (rules, procedures, scripts, guards) and the deterministic CLI `cw`. |
| `agents-progress` | A mod that shows the workflow's agents (avatars, role, tier, steps) and tasks (phase, review round, PR link, tickets other sessions hold) in the terminal and the Desktop app. |

Design and decisions: `PLAN.md` (German) and `plan/spec/` (English).

## Install in a project

Once per machine (the repository is private):

```bash
gh auth login && gh auth setup-git
```

Without a GitHub SSH key also set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`. Turn on auto-update under `/plugin` → Marketplaces → `remklov`.

In the project:

1. `/plugin marketplace add remklov/claude-tools`, then `/plugin install dev-workflow@remklov` and `/plugin install agents-progress@remklov`.
2. `/dev-workflow:setup` detects the stack and asks the open questions; it writes a proposed profile to a temporary file.
3. In your own terminal: `cw init --write --profile <file>` writes `.claude/workflow/profile.json`, merges `.claude/settings.json` (marketplace, plugins, permissions, worktree settings), registers the backlog merge driver, adds the CLAUDE.md/AGENTS.md section and compiles the rules into `.claude/rules/workflow/`. Commit the result.

`cw` is on the PATH of Claude Code's Bash tool while the plugin is enabled. To use it in your own terminal, put `~/.claude/plugins/…/dev-workflow/bin` on your PATH or call `node <plugin>/scripts/cw.mjs`.

## Work with it

```bash
claude --agent dev-workflow:orchestrator
```

Then say "starte mit Ticket NV-9" or "nimm das nächste Ticket". The orchestrator claims the ticket first (`refs/claims/<ID>` on `origin`, visible to every session and machine), writes the spec, classifies it, delegates to an implementer in its own worktree, runs the reviewer and, after your confirmation, opens the PR. In any other session `/dev-workflow:ticket <ID>` does the same.

Useful commands: `cw ticket list` (who works on what), `cw playbook show <role>` (what an agent gets), `cw rules show <ID|alias>`, `cw doctor`.

## Update

`/plugin marketplace update remklov` (or auto-update), then `cw rules build` in each project and commit the rulebook diff. The SessionStart hook reports an outdated rulebook.

## Develop the marketplace

```bash
tools/install-hooks.sh                       # commit-msg + pre-push gates
node --test plugins/dev-workflow/tests/unit/*.test.mjs
node plugins/dev-workflow/tools/generate-agents.mjs [--check]
claude plugin validate --strict . && claude plugin test plugins/agents-progress
```

Test a working copy in a project without releasing it: in the project's `.claude/settings.local.json` set `extraKnownMarketplaces.remklov.source` to `{ "source": "directory", "path": "<path to this checkout>" }`.

Release: bump `version` in the changed `plugin.json`, update `CHANGELOG.md`, merge, then `claude plugin tag --push` in each changed plugin directory.
