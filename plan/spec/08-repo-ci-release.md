# Spec 08 — Repository, CI, release and machine setup

## 1. Repository

- GitHub `remklov/claude-tools`, **private** (decision), default branch `main`, owner Benedikt Volkmer (sole author and owner of all imported material, including the existing progress mod and the workflow texts).
- License file: MIT (the mod contains MIT-licensed parts from savvy-progress; keeping the whole repo MIT is simplest; private repo is unaffected).
- Bootstrap (WP-01), run in `~/projects/claude-tools`:

```bash
git init -b main
git add PLAN.md plan/
git commit -m "Add the transformation plan"
gh repo create remklov/claude-tools --private --source . --remote origin \
  --description "Dev workflow marketplace: orchestrator, generalist agents, playbooks, stack packs, agents progress mod"
git push -u origin main
```

### 1.1 Layout

```text
claude-tools/
├── .claude-plugin/marketplace.json
├── plugins/
│   ├── dev-workflow/            # spec 02–06
│   └── agents-progress/         # spec 07
├── spikes/                      # spec 00 (not listed in the marketplace)
├── examples/fisko/              # reference overlay (profile, project rules, procedures)
├── docs/                        # architecture, playbooks, packs, profile, rules, install, migrate-*, adr/
├── plan/                        # this plan, backlog, specs, spike results
├── tools/prepush.sh             # local validation (plan B for CI validation)
├── .github/workflows/ci.yml
├── .gitignore                   # node_modules/, .DS_Store, plugins/*/.claude-plugin/types/ (generated mod types), coverage/
├── CHANGELOG.md
├── LICENSE
└── README.md                    # what it is, install (private repo), update, develop locally
```

### 1.2 `marketplace.json`

```json
{
  "name": "remklov",
  "owner": { "name": "Benedikt Volkmer", "url": "https://github.com/remklov" },
  "description": "Orchestrated dev workflow with generalist agents, role playbooks and stack packs, plus the agents progress mod.",
  "plugins": [
    { "name": "dev-workflow", "source": "./plugins/dev-workflow",
      "description": "Orchestrator, generalist implementer/reviewer/investigator agents, role playbooks, stack packs and the cw CLI.",
      "category": "workflow" },
    { "name": "agents-progress", "source": "./plugins/agents-progress",
      "description": "Mod: agents pane with avatars and a task band for the dev workflow; shows any subagents.",
      "category": "mod" }
  ]
}
```

Versions live only in each `plugin.json` (`1.0.0` at release; `0.x` during development).

### 1.3 Conventions for this repo

- Language: English for everything in the repo except `PLAN.md` and `plan/BACKLOG.md` (German working documents).
- Branch: `wp-<nn>-<slug>` (e.g. `wp-24-rules-compiler`); commit summary imperative, ≤ 72 characters, ending with ` (WP-<nn>)`; body wrapped at 72.
- Pull requests to `main`, merged by the owner. Phase 0–1 may commit directly to `main`.
- Every WP's acceptance criteria are checked in its PR description ("What & why", "Testing", "Open points").

## 2. CI — `.github/workflows/ci.yml`

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4.2.2
      - uses: actions/setup-node@v4.4.0
        with: { node-version: "22.23.0" }
      - name: Unit tests (cw, hooks, packs)
        run: node --test plugins/dev-workflow/tests
      - name: Agents match the matrix
        run: node plugins/dev-workflow/tools/generate-agents.mjs --check
      - name: Repo lint (budgets, no fable, schemas, secret scan)
        run: node plugins/dev-workflow/tools/repo-lint.mjs
      - name: Forbidden terms
        env: { FORBIDDEN_TERMS: "${{ secrets.FORBIDDEN_TERMS }}" }
        run: node plugins/dev-workflow/tools/repo-lint.mjs --terms --range "origin/${{ github.base_ref || 'main' }}..HEAD"
  validate:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4.2.2
      - uses: actions/setup-node@v4.4.0
        with: { node-version: "22.23.0" }
      - name: Install Claude Code
        run: curl -fsSL https://claude.ai/install.sh | bash && echo "$HOME/.local/bin" >> "$GITHUB_PATH"
      - name: Validate marketplace and plugins
        run: |
          claude plugin validate --strict .
          claude plugin validate --strict plugins/dev-workflow
          claude plugin validate --strict plugins/agents-progress
      - name: Mod tests
        run: claude plugin test plugins/agents-progress
```

The `validate` job depends on spike S11 (no login needed). If S11 fails, the job is removed and `tools/prepush.sh` (same commands) runs locally as a git `pre-push` hook. Action versions are pinned to full tags (GHA-PIN); the exact patch versions are checked when WP-11 is implemented.

`tools/repo-lint.mjs` checks: SKILL.md/step/reference line budgets (spec 05), no model ID containing `fable` in any agent or template, every `pack.json`/example profile validates against its schema, no credentials (patterns: `password`, `ghp_`, `m0-`, `AKIA`, private-key headers) in tracked files outside test fixtures that are marked as fake.

**Forbidden terms (owner rule):** the repository is a generic Remklov repository; names of former employers, clients and their projects must not appear anywhere — files, file names, commit messages, branch names, tags. The term list itself never enters the repository:
- Source: the GitHub Actions secret `FORBIDDEN_TERMS` (one term per line) in CI, and `~/.config/claude-tools/forbidden-terms` locally (`tools/prepush.sh`, also installed as a `commit-msg` hook by `tools/install-hooks.sh`).
- `repo-lint.mjs --terms` matches case-insensitively against tracked file contents, tracked paths, and the messages of the commits being pushed (`origin/main..HEAD`; in CI the PR's commits). Output names file and line but masks the matched term.
- Code imported from other repositories (the progress mod, workflow texts) is cleaned in the working tree **before** its first commit, and its git history is never imported.
- Missing term source → the check fails in CI and warns locally.

## 3. Release

1. Update `CHANGELOG.md` (Keep a Changelog format) and bump `version` in the changed `plugin.json` files (semver; rule changes are at least minor, because they change compiled rulebooks).
2. `claude plugin validate --strict .`
3. Merge to `main`.
4. In each changed plugin directory: `claude plugin tag --push` (creates `<plugin>--v<version>`).
5. Projects: `/plugin marketplace update remklov` (or auto-update), then `cw rules build` and commit the rulebook diff.

A `stable` channel (`#stable` ref) is not set up in release 1; add it when a second person uses the marketplace.

## 4. Machine setup (private repo)

On every machine that uses the marketplace (this host already has `gh` logged in as `remklov` with SSH):

```bash
gh auth login              # once, if not logged in
gh auth setup-git          # credential helper for HTTPS clones and background auto-update
```

Without a GitHub SSH key, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` (in the shell profile or `env` of `~/.claude/settings.json`). Enable auto-update per machine: `/plugin` → Marketplaces → `remklov` → Enable auto-update. `cw doctor` reports a missing credential helper when the marketplace source is HTTPS.

Local development of the marketplace (spec 09 uses this for the pilot): in the target project's `.claude/settings.local.json`

```json
{ "extraKnownMarketplaces": { "remklov": { "source": { "source": "directory", "path": "/home/dispatcher/projects/claude-tools" } } } }
```

loads the plugins in place (edits apply at the next session start or `/reload-plugins`, no version bumps).

## 5. Removing the savvy plugins (WP-00, decision)

User level (this host; repeat on every other machine that has them):

```bash
claude plugin uninstall savvy-flow@claude-kit
claude plugin uninstall savvy-progress@claude-kit
claude plugin marketplace remove claude-kit
```

Then edit `~/.claude/settings.json`: remove `enabledPlugins["savvy-progress@claude-kit"]`, `enabledPlugins["savvy-flow@claude-kit"]`, `pluginConfigs["savvy-progress@claude-kit"]` and `extraKnownMarketplaces["claude-kit"]` (otherwise the marketplace is registered again at the next start). Check with `claude plugin list` and `claude plugin marketplace list`.

fisko (in a commit on `main`, before the migration or as its first commit): remove `mcp__savvy-progress__progress` and `mcp__savvy-progress__step` from `.claude/settings.json` `permissions.allow`. The current fisko agents call these tools only "if available" and keep working without them until the migration replaces them.
