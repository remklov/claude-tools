# CLAUDE.md: claude-tools

This repository is the private Claude Code marketplace `remklov` (GitHub `remklov/claude-tools`) with two plugins: `dev-workflow` (the orchestrated multi-agent workflow and the `cw` CLI) and `agents-progress` (a mod that shows the workflow's agents and tasks). The build plan is `docs/PLAN.md`; read the sections that the task touches before changing anything.

## Language

Everything in the repository is English: code, comments, identifiers, commit messages, docs. The reply in the chat follows the developer's language.

## Git conventions

Git workflow of the `default` preset, with the no-ticket key `NO-TICKET`:

- Branch `<TICKET>/<type>/<short-description>`, with `type` ∈ `feature`, `bugfix`, `hotfix`, and a short description of 2–4 lowercase words joined by hyphens, e.g. `NO-TICKET/feature/cw-core`.
- Commit summary `[KEYWORD] Summary in imperative mood`, under 72 characters (ideally under 52). Keywords `[FEATURE]`, `[BUGFIX]`, `[TASK]`, `[DOCS]`; the flags `[!!!]` and `[SECURITY]` go before the keyword. An optional body explains why, wrapped at 72.
- Last line `Relates to <TICKET>`, one line per ticket; left out for `NO-TICKET`.
- PR title follows the summary rules. Description sections "What & why", "Testing" (only what was actually verified), "Risks & deploy steps", "Open points"; empty sections are left out.
- Commit only when asked. Never commit to `main` after the bootstrap commit, never push without being asked, never merge.

## Invariants

- **Never rename a plugin** after its first release: the name is the stable id in every project's `enabledPlugins`.
- **No dependency between the plugins**: a `dependencies` entry installs the other plugin automatically, and neither plugin is ever installed without consent.
- **No root `settings.json` in either plugin**: its `agent` key would make every session the orchestrator (D2).
- **Versions live only in each `plugin.json`** (semver), not in `marketplace.json`.
- **No npm dependencies and no build step** for `cw` and the hooks: Node ≥ 20, ESM.
- **Hooks fail open** on internal errors. The only exceptions are the deliberate guard denies and SubagentStop blocks.
- **The implementer agents are generated**: edit `plugins/dev-workflow/tools/generate-agents.mjs`, never `agents/implementer-*.md`. `agents/reviewer.md` is hand-written; `--check` compares its model, effort and colour with the matrix and keeps it read-only.
- **Technical claims need evidence**: a statement about Claude Code, `gh` or `glab` is backed by documentation or marked as an observation with the surface and version (`docs/PLAN.md` Appendix A and D).
- **No names of the former context**: the private list of terms (`~/.config/claude-tools/forbidden-terms`, CI secret `FORBIDDEN_TERMS`) applies to files, paths, branch names, commit messages and commit authors. The list itself never enters the repository. Run `tools/install-hooks.sh` once per clone.
- **`.spikes/` is never committed**: throwaway spike plugins, fixtures and their evidence stay there.

## Develop and test

```bash
node --test plugins/dev-workflow/tests/*/*.test.mjs      # unit tests (the shell expands the glob; Node ≥ 21 no longer takes a folder)
node --test tests/dry-run/make-project.test.mjs           # the dry-run kit (docs/dry-run.md); outside the plugin glob
node plugins/dev-workflow/tools/generate-agents.mjs       # regenerate the implementer agents
node plugins/dev-workflow/tools/generate-agents.mjs --check
node plugins/dev-workflow/tools/repo-lint.mjs --range origin/main..HEAD   # budgets, private terms (also in commits), manifests, agents
claude plugin validate --strict .                         # marketplace
claude plugin validate --strict plugins/dev-workflow
claude plugin validate --strict plugins/agents-progress
claude plugin test plugins/agents-progress                # the mod's tests
bash tests/setup.test.sh                                  # setup.sh against stub claude, ssh, gh and glab
claude --plugin-dir plugins/dev-workflow                  # load the plugin for one session
```

CI (`.github/workflows/ci.yml`) runs the tests on Node 20 and 22, the generator check, repo-lint (with the private-terms list from the `FORBIDDEN_TERMS` secret, also over the commit messages), the setup.sh tests, shellcheck, `claude plugin validate --strict` and the mod tests on pull requests and on `main`. `tools/install-hooks.sh` installs the same checks as local `commit-msg` and `pre-push` hooks.

## Release

Per plugin: add a `## <plugin> <version> - YYYY-MM-DD` section to `CHANGELOG.md` (Keep a Changelog), bump `version` in its `plugin.json`, merge, then run `claude plugin tag --push` in the plugin's folder on the updated `main` (tag `<plugin>--v<version>`). The marketplace is private: projects declare it as the github source `remklov/claude-tools`, which Claude Code clones over SSH (`git@github.com:remklov/claude-tools.git`).
