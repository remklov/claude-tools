# Extending

How to change or extend the workflow without breaking its invariants. [architecture.md](architecture.md) explains how the parts fit together, [config.md](config.md) the project config and [packs.md](packs.md) the bundled packs; `CLAUDE.md` holds the conventions and `docs/PLAN.md` the decisions behind them.

The invariants every change keeps (`CLAUDE.md`):

- Never rename a plugin after its first release; no `dependencies` between the plugins; no root `settings.json` in either plugin.
- No npm dependencies and no build step for `cw` and the hooks (Node ≥ 20, ESM).
- Hooks fail open; the only exceptions are the deliberate guard denies and SubagentStop blocks.
- The implementer agents are generated; never edit `agents/implementer-*.md` by hand.
- A statement about Claude Code, `gh` or `glab` is backed by documentation or marked as an observation with the surface and version.

## A project's own rules

A project changes the rulebook in two places: the `rules` block of `.claude/dev-workflow/config.json`, and rule files under `.claude/dev-workflow/rules/`. `cli/lib/rules.mjs` applies them after core and the packs, in the order add → override → extend → disable.

| Key | Shape | Effect |
|---|---|---|
| `add` | `["<path>"]` | Further rule files, relative to the config root. Every `.claude/dev-workflow/rules/*.md` is loaded anyway, in name order |
| `override` | `{ "<ID>": { "file": "<path>", "reason": "…" } }` | Replaces a rule. A file that starts with `## <ID> — Title` holds exactly that one rule and replaces title, severity, scope and body; any other file replaces the body only. A protected rule stays protected |
| `extend` | `{ "<ID>": "<Markdown>" }` | Appends the text to the rule's body as `**Project addition:** …` |
| `disable` | `[{ "id": "<ID>", "reason": "…" }]` | Turns a rule off; the reason is required and listed under "Disabled in this project" in `00-global.md` |
| `options` | `{ "<ID>": { … } }` | Values for the rule's `{ruleOptions.x}` placeholders |
| `allowProtected` | `true \| false` (default false) | Needed, with a reason, to disable or override a protected rule (`CORE-SECRETS`, `CORE-INJECTION`, `CORE-LOGGING`, `REACT-NO-RAW-HTML`, `VITE-ENV-SECRETS`) |

An unknown ID in any of these sections, a missing file, a disable without reason and a protected rule changed without `allowProtected` are build errors (exit 1), all reported in one run.

### The rule file format

The same grammar as the pack rules (PLAN §7); frontmatter and text before the first heading are ignored.

```markdown
## PROJ-API-VERSION — Versioned API routes
<!-- rule: severity=blocking; scope=paths:server/src/routes/**|server/src/api/** -->
Every new route lives under `{ruleOptions.prefix}`. …
```

- **Heading:** `## <ID> — <Title>` (an em dash or a hyphen). The ID is upper case with at least one hyphen (`^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$`). Give project rules a project prefix; a pack prefix such as `CORE-` gives a warning, a duplicate ID an error.
- **Meta line** right below the heading: `<!-- rule: severity=…; scope=…; protected=…; when=… -->`.

  | Key | Values | Default |
  |---|---|---|
  | `severity` | `blocking`, `advisory` | `blocking` |
  | `scope` | `all`, `areas:<a>,<b>`, `paths:<glob>\|<glob>` | `all` |
  | `protected` | `true`, `false` | `false` |
  | `when` | `option:<name>` or `option:<name>=<value>`: active only for that pack option; pack rules only | – |

- **Body:** everything up to the next `## ` line; an empty body is an error.
- **Placeholders:** `{options.x}` (pack options; pack rules only), `{ruleOptions.x}` (from `rules.options.<ID>`), `{project.name}`, `{project.language.repo}`, `{project.language.productCopy}`. An unresolved placeholder is a build error.
- **Scopes:** `areas:` matches the packages with that area, `paths:` globs are relative to the work repo. In in-place mode the compiled files get the `appRoot` prefix.

After a change run `cw rules build`: it writes `.claude/rules/dev-workflow/` (`00-global.md`, `area-<areas>.md`, `paths-<pack>-<n>.md`) and `.claude/dev-workflow/rulebook.lock.json`, which `cw init` lists among the files to commit. `cw rules build --check` reports drift without writing, and so do the SessionStart hook and `cw doctor`. `cw rules list` and `cw rules show <ID>` show the result.

A project can also bring its own procedures (`.claude/dev-workflow/procedures/<role>/*.md`, format in `docs/playbooks.md`) and its own packs (`.claude/dev-workflow/packs/<id>/`, next section). A project pack with the id of a bundled pack shadows it with a warning and must keep the bundled pack's protected rules, unless `allowProtected` is set.

## A new pack

A pack is a directory `packs/<id>/` in the plugin, or `.claude/dev-workflow/packs/<id>/` in a project; the project's copy wins. Procedures are found by directory, not listed in the manifest.

```text
packs/<id>/
├── pack.json                    # the manifest, schemas/pack.schema.json
├── rules.md                     # base rules; a variant may add rules.<variant>.md
├── procedures/<role>/*.md       # role: orchestrator, implementer or reviewer
└── scripts/<name>.mjs           # run by cw run <id>:<name>, cw review scope or cw init
```

| Manifest key | What |
|---|---|
| `id`, `version`, `title` (required), `description` | `id` equals the directory name; `version` is semver |
| `requires`, `conflicts` | Required packs load first (with a warning when the config does not list them); a conflict is an error |
| `detect` | Any-of `{ "glob" }` in the work repo or `{ "dependency", "major"? }` in a `package.json`; `cw init` proposes the pack on a hit, with the variant whose `detect` matched |
| `areas` | The areas the pack serves. `cw init` does not read it: it derives package areas (`react` → frontend, `express` → backend) and pack options (`detectedOptions`) in `cli/lib/init.mjs` itself |
| `variants`, `defaultVariant` | Each variant has a `description`, optional `rules` file and `detect`; a variant's rules come after the base file and may redefine a base rule ID |
| `options` | `{ type, required?, default?, description }`; the config sets them per pack (`{ "id": "<id>", "options": { … } }`); rules, procedures, guard commands and complexity paths read them as `{options.x}` |
| `rules` | The base rule file |
| `scripts` | `{ "<name>": "scripts/<file>.mjs" }`, run as `<id>:<name>` |
| `checkDiscovery` | A script `cw init` runs to suggest each package's checks: one JSON object `{ "<dir>": { "test"?, "typecheck"?, "lint"? } }` on stdout |
| `scopeScripts` | Scripts `cw review scope` runs (R1): exit 1 is a finding; another exit or a timeout means the check did not finish |
| `testRunner.single` | The single-test command for `cw prove`: `{file}` required, `{name}` only inside an optional `[ … ]` segment. The last active pack with one wins; `packages[].testSingle` overrides it |
| `guards` | `dependencyCommands` (G-DEPS), `commands` (G-COMMANDS), `ports` (G-PORTS), for workflow agents |
| `settings` | `allow`, `ask`, `deny` permission rules; `cw init` merges them into `.claude/settings.json`. It refuses that inside Claude Code (`CLAUDECODE=1`), so `setup.sh` runs it in a terminal |
| `complexity.escalate` | `{ paths?, keywords?, min, reason }` items, like the config's; they raise the classification minimum |

`cw` validates a manifest with the schema plus cross-field checks (`validatePackManifest` in `cli/lib/packs.mjs`): the id matches the directory, `defaultVariant` names a variant, `checkDiscovery` and `scopeScripts` name scripts, defaults match their option type, listed files exist, the test template is usable and the globs compile.

A script runs with `node` in the task's work tree (the work repo without `--task`), with a 10-minute timeout and these variables: `CW_WORK_TREE`, `CW_CONFIG_ROOT`, `CW_PACK_OPTIONS` (JSON), `CW_TASK`, `CW_TASK_DIR`, `CW_BASE`, `CW_DEFAULT_BASE`, `CW_PACKAGE_DIRS` (JSON). The plugin ships no `node_modules`, so a script uses Node's built-in modules only (`runPackScript` in `cli/lib/packs.mjs`).

**Tests that cover packs:**

| File | Covers |
|---|---|
| `tests/unit/packs.test.mjs` | Every bundled pack is valid: it pins the list of bundled packs and of their procedures, so a new pack or procedure is added there. Also resolution, placeholders, test runner, guards, settings, scripts and detection |
| `tests/unit/rules.test.mjs` | Rule grammar, layering, customizations, protected rules, scopes, outputs, drift |
| `tests/unit/procedures.test.mjs` | Procedure loading and deterministic selection |
| `tests/unit/run.test.mjs` | The bundled pack scripts and `cw run` |
| `tests/unit/init.test.mjs` | Detection, check discovery and the settings fragment of `cw init` |
| `tests/unit/migration-map.test.mjs` | The Acme Shop pack set: it pins its 35 rules to the v1 packs table in PLAN §7 and to `docs/migration/cq-rules.md`, so adding, removing or renaming a rule in `core`, `node-npm`, `typescript`, `express`, `react-vite` or `vitest` fails it until both match |

## Agents

- **Model, effort, colour, guardrails, body text:** edit `MATRIX` or `renderImplementer` in `tools/generate-agents.mjs`, or the guardrail lists in `cli/lib/guardrails.mjs` (the briefs print the same lists). Then run `node plugins/dev-workflow/tools/generate-agents.mjs` and commit the regenerated `agents/implementer-*.md`; `--check` fails while they differ.
- **The reviewer:** edit `agents/reviewer.md` by hand and keep `MATRIX.reviewer` in step: `--check` compares model, effort and colour, requires `disallowedTools: Edit, Agent` and refuses `permissionMode`, `hooks`, `mcpServers`, `initialPrompt` and `isolation`. repo-lint refuses those fields in every agent file.
- **Tests:** `tests/unit/tools.test.mjs` covers the generator and repo-lint.

**A new tier** has no single switch: the four tiers are spelled out in each of these places.

| Where | What |
|---|---|
| `tools/generate-agents.mjs` | `MATRIX` and the `['s', 'm', 'l', 'xl']` loop in `run` |
| `cli/lib/guardrails.mjs` | `COMPLEXITIES` and `GUARDRAILS` |
| `schemas/config.schema.json`, `pack.schema.json`, `dev-report.schema.json` | the `s`, `m`, `l`, `xl` enums |
| `hooks/hooks.json`, `hooks/lib/context.mjs`, `hooks/lib/guards.mjs` | the SubagentStop matcher, `ROLE`, `IMPLEMENTER_AGENT` |
| `cli/commands/classify.mjs` | the usage text |
| `plugins/agents-progress/hooks/state.ts`, `avatars.ts` | `TIERS` and the tier colours and badges, released with the mod |

## Guards and hooks

- **The catalog** is `hooks/lib/guards.mjs`: `evaluate` dispatches by tool, `bashGuards` checks each command the parser (`hooks/lib/shell.mjs`) finds in a Bash call, and every guard returns `deny(id, reason)` with a reason that names the alternative. `hooks/guard.mjs` is the entry point and `hooks/hooks.json` the registration.
- **Prefer data.** A project blocks commands, ports and dev servers with `guards.commands`, `guards.ports` and `guards.devServer` in its config; a pack with `guards.dependencyCommands`, `commands` and `ports`. Neither needs code. Keep the coded catalog small (D12).
- **Fail open.** Every hook script runs its body through `runHook` (`hooks/lib/run.mjs`); an exception is logged to `<git common dir>/dev-workflow/hooks.log` and the hook exits 0. A guard only denies; it never allows or asks. No network in hooks, and a typical guard call stays well under 300 ms (D11; `tests/integration/hooks.test.mjs` measures it).
- **Tests.** `tests/unit/hooks-guards.test.mjs` gives each guard a positive case, a negative case and the bypass forms (`bypasses()`: `&&`, `;`, pipes, `$(…)`, backticks, `bash -c`, heredocs, the wrappers, `/usr/bin/git`). `tests/unit/hooks-shell.test.mjs` covers the parser, `tests/unit/hooks-context.test.mjs` the roles, the cache and the agent context, and `tests/integration/hooks.test.mjs` the four scripts with the stdin fixtures in `tests/fixtures/hooks/`.
- **Docs.** Update the guard list at the top of `guards.mjs` and the guard table in `docs/playbooks.md`.

## Git presets and hosts

**A git preset** is data: `presets/git/<name>.json`, chosen with `git.preset` in the config (default `default`); a name without a file is a config error. It sets the branch template (`{ticket}/{type}/{slug}`), the `types`, the `slug` pattern, `noTicketKey`, the commit `keywords`, `flags`, `summaryMax`, `summaryIdeal`, `bodyWrap` and `trailers`, and the PR/MR `sections` and `trailers`. The summary shape `[FLAG][KEYWORD] Summary` is code (`cli/lib/commit.mjs`). The usage texts and the skills name the `default` values (`--type feature`, `--keyword FEATURE`), and `tests/unit/skills.test.mjs` runs those lines against a fixture project, so a preset with other types or keywords also needs those texts checked. Tests: `tests/unit/commit.test.mjs`, `tests/unit/base.test.mjs`.

**A git host** has no registry. `cli/lib/host/` holds two adapters, `github.mjs` (`gh`) and `gitlab.mjs` (`glab`), each `{ kind, cli, installHint, loginHint, findExisting, createCommand }`. `detectHost` in `host/index.mjs` reads the work repo's `origin`: `github.com` is GitHub, any other host GitLab, a local path or no origin none; `git.host` (`github` or `gitlab`) overrides it. A third host would change `adapterFor` and `detectHost`, the `git.host` enum in `schemas/config.schema.json`, the host check in `cli/lib/doctor.mjs`, the login step of `setup.sh`, and the `core` pack's `ask` rules, which must cover every command `cw pr command` prints (a test in `tests/unit/packs.test.mjs`). Tests: `tests/unit/host.test.mjs`, `tests/unit/pr.test.mjs`, `tests/integration/delivery.test.mjs`.

## Skills

- **Budgets:** `SKILL.md` ≤ 200 lines, a step file ≤ 80, a reference file ≤ 150; repo-lint and `tests/unit/skills.test.mjs` both check them. Move detail into a step or reference file of the `ticket` skill. The agent playbooks are preloaded whole, so they keep everything in `SKILL.md`.
- **Step and reference files** of `ticket` are read with `cw playbook read steps/<file>` or `cw playbook read reference/<file>`; name a new one that way in `SKILL.md`. The test requires every referenced file to exist and every step and reference file to be referenced.
- **Every `cw` line** in a skill is checked: the command and its flags against the registry, and the whole line through cw's own `main()` against a fixture task, with the placeholders filled, in each phase. Exit 2 fails the test; a snippet that names only the command is a mention and is not run.
- **Role commands:** `ROLES` in `cli/commands/playbook.mjs` lists the commands `cw playbook show` prints per role. Every one of them must be in the test's `REQUIRED` map, and every `REQUIRED` command and flag must appear in a `cw` line of the role's skill; a command added to or dropped from a role changes all three.
- **Frontmatter:** only documented fields; `ticket` keeps `disable-model-invocation: true`, the agent playbooks `user-invocable: false`. A new skill is added to the test's `EXPECTED` list.
- **After a compaction** Claude Code re-attaches the first 5,000 tokens of an invoked skill (`docs/playbooks.md`), so the ground rules stay at the top of `ticket/SKILL.md`.

## Before a pull request

From the repository root (the same checks run in `.github/workflows/ci.yml`; `tools/prepush.sh` runs them all, and `tools/install-hooks.sh` makes it the pre-push hook):

```bash
node --test plugins/dev-workflow/tests/*/*.test.mjs      # unit and integration tests
node --test tests/dry-run/make-project.test.mjs           # the dry-run kit
node plugins/dev-workflow/tools/generate-agents.mjs --check
node plugins/dev-workflow/tools/repo-lint.mjs --range origin/main..HEAD   # budgets, private terms (also in commits), manifests, agents
bash tests/setup.test.sh                                  # setup.sh with stub claude, ssh, gh, glab
git ls-files -z '*.sh' | xargs -0 shellcheck                # as CI runs it
claude plugin validate --strict .
claude plugin validate --strict plugins/dev-workflow
claude plugin validate --strict plugins/agents-progress
claude plugin test plugins/agents-progress                # the mod's tests
```

`claude --plugin-dir plugins/dev-workflow` loads the plugin for one session; `docs/dry-run.md` is the manual end-to-end check. The pull request follows the conventions in `CLAUDE.md`, and its "Testing" section names only what was actually run.

## Release

Each plugin is released on its own:

1. Add a `## <plugin> <version> - YYYY-MM-DD` section to `CHANGELOG.md` (Keep a Changelog).
2. Bump `version` in that plugin's `.claude-plugin/plugin.json` (semver). The version lives nowhere else; repo-lint refuses a `version` in `marketplace.json`.
3. Merge, then run `claude plugin tag --push` in the plugin's folder on the updated `main` (tag `<plugin>--v<version>`).

Never rename a plugin after its first release: the name is the stable id in every project's `enabledPlugins`. A change on both sides, such as a new tier, ships as a release of each plugin.
