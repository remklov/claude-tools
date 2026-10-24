# Project config

Every project that uses the dev workflow has one file, `.claude/dev-workflow/config.json`, committed with the project. It names the workspace mode, the packages and their checks, the active [packs](packs.md), the rule customizations and a few workflow limits (`docs/PLAN.md` §5).

- **Schema:** `plugins/dev-workflow/schemas/config.schema.json`. Unknown keys are refused everywhere except in the free-form maps (`checks`, `env`, pack `options`, `rules.options`).
- **Cross-field checks and defaults:** `cli/lib/config.mjs` (`validateConfig`, `withDefaults`).
- `cw config show` prints the effective config with every default filled in.

## Where the file lives

- The path is `<project root>/.claude/dev-workflow/config.json`. The project root is the **config root**.
- `cw` and the hooks find it by walking **up from the cwd** to the nearest directory that has the file, also across nested git roots, so `cw` works from inside `app/` too (D5). Without a config `cw` exits 3 and names the fix.
- The config root must be inside a git repository: the task state lives in its git common dir, at `.git/dev-workflow/`.
- Next to the config, in `.claude/dev-workflow/`: project rules `rules/*.md`, project procedures `procedures/<role>/*.md`, project-local packs `packs/<id>/`, and the generated `rulebook.lock.json`. The compiled rules go to `.claude/rules/dev-workflow/` ([packs.md](packs.md)).

## Top level

| Key | Type | Required | Default |
|---|---|---|---|
| `version` | `1` | yes | – |
| `project` | object | yes | – |
| `workspace` | object | no | `{ "mode": "worktree" }` |
| `packs` | array | yes (may be empty) | `core` is always added first |
| `packages` | array, at least one | yes | – |
| `git` | object | no | preset `default`, base `main` |
| `tickets` | object | no | Jira, key pattern `^[A-Z][A-Z0-9]+-[0-9]+$` |
| `workflow` | object | no | see below |
| `guards` | object | no | nothing guarded |
| `complexity` | object | no | no escalation |
| `rules` | object | no | no customization |

## project

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | string, not empty | – (required) | The project's name; `{project.name}` in rule and procedure texts. |
| `language.repo` | two lowercase letters | `en` | Language of code, comments, commits and developer docs; `{project.language.repo}` (CORE-NAMING, CORE-LANGUAGE). |
| `language.productCopy` | two lowercase letters | `language.repo` | Language of user-facing copy; `{project.language.productCopy}` (CORE-LANGUAGE). |

## workspace

| Field | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `in-place` \| `worktree` | `worktree` | Where the application lives and where implementers work. |
| `appRoot` | string | – | The application repository, relative to the config root. Required for `in-place`. |

The two modes (D5):

- **`in-place`**: the application is a nested git repository at `appRoot` (for example `app`), which the outer repository ignores. All git and check operations target `<config root>/<appRoot>`, the **work repo**. One task at a time works in it: `cw task start` refuses while another started task holds it. `cw` prints git commands as `git -C <appRoot> …`, relative to the project root. `appRoot` must be relative, inside the project, without `..` and not `.`.
- **`worktree`**: the application is the repository root. Each implementer works in its own git worktree, which Claude Code creates under `.claude/worktrees/`; `cw ws setup` creates the task branch there, so tasks can run in parallel. `appRoot` is only allowed as `.` in this mode.

## packages

A package is a directory of the work repo with its own checks. At least one is required.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | `^[a-z0-9][a-z0-9-]*$`, unique | – (required) | Used in `cw checks --package`, `cw prove --test <pkg>:<file>` and classifications. |
| `path` | string, unique | – (required) | Relative to the work repo root; no leading `/` and no `..`. `./x/` is normalized to `x`; `.` is the whole repo. |
| `areas` | array of `^[a-z][a-z0-9-]*$`, at least one | – (required) | The package's areas, for example `frontend`, `backend`. |
| `checks` | object, name → command | `{}` | The commands `cw checks` runs, in the order written. |
| `testSingle` | string | the pack's test runner | The single-test command for `cw prove`. |
| `env` | object, name → string | `{}` | Environment for the package's checks and single-test runs. |

- **Ownership.** A file belongs to the package with the longest matching path; `.` matches every file. A changed file that no package owns is listed as unowned by `cw classify` and `cw review scope`.
- **Areas** select the area-scoped rules (`scope=areas:backend` compiles to the paths of the packages with that area), the procedures' `when.areas`, and the areas `cw classify` reports. A rule whose area no package has is inactive.
- **Checks** run with `cwd = <work tree>/<path>`, each with the timeout `workflow.checkTimeoutMinutes`. A package without checks passes `cw checks` without running anything; `cw init` warns about it and asks for a test command.
- **`testSingle`** overrides the active packs' `testRunner.single` for this package. It must contain `{file}` outside the optional `[ … {name} … ]` segment, which is dropped when no test name is given; `{name}` outside a segment makes a test name required. A placeholder is either quoted on its own (`"{file}"`) or unquoted with no quote, `$` or `\` next to it: `./{file}` is fine, `"./{file}"` is not. Example: `node --test {file} [--test-name-pattern "{name}"]`.
- **`env`** values are masked in all output, and `cw config show` prints them as `***`. Values shorter than 6 characters are not masked inside check logs and messages; `cw config validate` warns about each.

## packs

A list of pack ids or objects. The bundled packs are `core`, `node-npm`, `typescript`, `express`, `react-vite` and `vitest` ([packs.md](packs.md)).

| Form | Meaning |
|---|---|
| `"vitest"` | The pack with its default variant and default options. |
| `{ "id": "express", "variant": "5", "options": { "appEntry": "createApp()" } }` | A variant and options. `variant` is a string, `options` an object. |

- Ids match `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` and appear once. `core` is always active and need not be listed.
- Pack ids, variants and options are checked when the packs resolve (`cw rules build`, `cw doctor` and every command that reads the packs), not by `cw config validate`: an unknown pack, variant or option, an option of the wrong type, or a missing required option (express `appEntry`) is an error there.
- A pack without a `variant` gets its `defaultVariant`. A pack that `requires` another adds it with a warning.

## rules

Customizations of the compiled rulebook ([packs.md](packs.md#compiling-the-rules)). Every ID must name a rule of the active packs or the project; an unknown ID is a build error.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `add` | array of file paths | `[]` | Further project rule files, relative to the config root. Every `.claude/dev-workflow/rules/*.md` is loaded anyway. |
| `override` | object, ID → `{ file, reason? }` | `{}` | Replaces a rule from a file. A file that starts with `## ` holds exactly that one rule (title, severity, scope and body are replaced); any other file replaces only the body. |
| `extend` | object, ID → Markdown | `{}` | Appended to the rule as `**Project addition:** …`. |
| `disable` | array of `{ id, reason }` | `[]` | Removes the rule. The reason is required and listed under "Disabled in this project" in `00-global.md`. |
| `options` | object, ID → object | `{}` | Values for the rule's `{ruleOptions.x}` placeholders. |
| `allowProtected` | boolean | `false` | Required to disable or override a protected rule. |

- A protected rule can be disabled only with `allowProtected: true`, and overridden only with `allowProtected: true` and a `reason`. An overridden protected rule stays protected. `cw rules build` prints a warning for each.
- Customizing a rule that is inactive (a pack option or a missing area switches it off) has no effect and prints a warning.

## workflow

| Field | Type | Default | Meaning |
|---|---|---|---|
| `maxReviewRounds` | integer 1–10 | `3` | `cw review show` escalates the task to the user when changes are requested in this round. |
| `confirm` | array of `s`, `m`, `l`, `xl` | `["l", "xl"]` | Complexities the user confirms: `cw task start` refuses them until `cw task confirm`. |
| `maxQuestionsPerRound` | integer 1–10 | `4` | The most AskUserQuestion questions per round in O2 Clarify; the `ticket` skill reads it from `cw config show`. |
| `checkTimeoutMinutes` | integer 1–240 | `15` | Timeout of each check command and each single-test run of `cw prove`. |
| `freshImplementerAboveTokens` | integer ≥ 0 or `null` | `150000` | `cw task return` starts a fresh implementer instead of a SendMessage when the current one's context (the input tokens of its last API call) is larger; `0` or `null` switches this off ([ADR 0012](adr/0012-fresh-implementer-above-context.md)). |

## guards

Project additions to the PreToolUse guards ([playbooks](playbooks.md), PLAN §9). They apply to the workflow agents (implementer and reviewer), not to the main session.

| Field | Type | Default | Guard | Refuses |
|---|---|---|---|---|
| `ports` | array of integers 1–65535 | `[]` | G-PORTS | A command that binds or contacts one of the ports; `grep`, `cat`, `echo`, `cw` and git outside its network subcommands only mention it. |
| `commands` | array of strings | `[]` | G-COMMANDS | A command whose program and first arguments match, for example `"npm run deploy"`, also behind `npx` and the package runners. |
| `devServer` | `allowed` \| `never` | `allowed` | G-DEVSERVER | With `never`: dev servers such as `npm run dev`, `npm start`, `vite`, `next dev`, `node --watch`. |

Packs add their own guarded commands and ports to these lists ([packs.md](packs.md)).

## complexity

`complexity.escalate` sets a minimum complexity for some changes; `cw classify` applies it in O4.

| Field | Type | Meaning |
|---|---|---|
| `paths` | array of globs, at least one | Matched against the spec's Context paths (plus `cw classify --paths`). |
| `keywords` | array of strings, at least one | Matched as whole words, case-insensitive, in the spec's title and requirements. |
| `min` | `s` \| `m` \| `l` \| `xl` | Required. The minimum when the item matches. |
| `reason` | string | Required. Shown with the classification. |

An item needs `paths` or `keywords`, and every glob must compile. The highest `min` of all matching items is the minimum; choosing a lower level needs `cw classify --set <level> --why "…" --override "<reason>"`, approved by the user. Packs may contribute items of the same shape.

## git

| Field | Type | Default | Meaning |
|---|---|---|---|
| `preset` | `^[a-z][a-z0-9-]*$` | `default` | The conventions file `presets/git/<preset>.json` in the plugin; the name must exist. |
| `defaultBase` | string | `main` | The branch `cw task start` bases a task on unless `--base` names another; it must exist locally in the work repo. |
| `noTicketKey` | `^[A-Za-z][A-Za-z0-9-]*$` | the preset's (`maintenance` for `default`) | The key for work without a ticket. It must not match `tickets.keyPattern`. `NO-TICKET` is always accepted as an alias. |
| `host` | `github` \| `gitlab` | detected | Overrides the host detection from the work repo's `origin` (`github.com` → GitHub, any other host → GitLab). |

The conventions are not written in the config: `withDefaults` merges the preset into the effective config as `git.conventions`, and `cw config show` prints only its id there. The `default` preset defines the branch `{ticket}/{type}/{slug}` with the types `feature`, `bugfix`, `hotfix`, the commit keywords and flags, the summary limits (72, ideally 52), the trailer `Relates to {ticket}`, and the PR/MR sections.

The `ticket-suffix` preset keeps the ticket in the summary instead: branch `{ticketLower}-{slug}` (`nv-9-cre-totaliva`), `chore-{slug}` for the no-ticket key, commit summary `<Summary> (<TICKET>)` without keywords, flags or trailers, the PR/MR title = the oldest commit's summary, and the sections "What & why", "Affected packages", "Testing", "Risks & deploy steps", "Open points" and "Screenshots"; its no-ticket key is `NO-TICKET`.

## tickets

| Field | Type | Default | Meaning |
|---|---|---|---|
| `source` | `local` \| `jira` \| `linear` | `local` | Where tickets come from: a Markdown file per ticket in the project (`contextPath`), Jira through the MCP server of Atlassian's `atlassian` plugin (`claude plugin install atlassian@claude-plugins-official --scope project`), or Linear through Linear's MCP server in the project's `.mcp.json`. The orchestrator reads a ticket once and never writes to it (ADR 0009). |
| `site` | host name, e.g. `your-company.atlassian.net` | none | Jira only: the site; the orchestrator passes it as `cloudId` in its one Jira read. Without it the orchestrator looks the site up once. |
| `keyPattern` | regular expression | `^[A-Z][A-Z0-9]+-[0-9]+$` | What counts as a ticket key in `cw task new` and `cw spec lint`. It must compile. |
| `contextPath` | relative path with `{key}`, e.g. `docs/specs/{key}.md` | `docs/tickets/{key}.md` for `local`, else none | A file per ticket, relative to the project root. For `local` it is the ticket. For `jira` and `linear` it is optional technical context: when the file of a key exists, the orchestrator reads it with the ticket, saves its path in the snapshot, and the brief names it. No leading `/`, no `..`. `cw ticket context --ticket <KEY>` prints the file of a key. |

## Example

An in-place project with an API and a web package:

```json
{
  "version": 1,
  "project": { "name": "Shop", "language": { "repo": "en", "productCopy": "de" } },
  "workspace": { "mode": "in-place", "appRoot": "app" },
  "packs": [
    "node-npm",
    { "id": "typescript", "options": { "moduleResolution": "nodenext" } },
    { "id": "express", "variant": "5", "options": { "appEntry": "createApp()" } },
    { "id": "react-vite", "variant": "react-19" },
    "vitest"
  ],
  "packages": [
    { "id": "api", "path": "packages/api", "areas": ["backend"],
      "checks": { "test": "npm test", "typecheck": "npm run typecheck" } },
    { "id": "web", "path": "packages/web", "areas": ["frontend"],
      "checks": { "test": "npm test", "lint": "npm run lint" } }
  ],
  "git": { "preset": "default", "defaultBase": "main", "noTicketKey": "NO-TICKET" },
  "tickets": { "source": "jira", "site": "example.atlassian.net" },
  "workflow": { "maxReviewRounds": 3, "confirm": ["l", "xl"] },
  "guards": { "ports": [3000, 5173], "devServer": "never" },
  "complexity": {
    "escalate": [{ "paths": ["packages/api/src/auth/**"], "min": "l", "reason": "Authentication code" }]
  },
  "rules": { "disable": [{ "id": "NPM-CI", "reason": "CI files are owned by the platform team" }] }
}
```

- `appRoot: "app"`: the packages' paths are relative to `app/`, and the compiled rules carry the `app/` prefix.
- `core` is not listed; it is active anyway. `express` needs `appEntry`; `moduleResolution: "nodenext"` activates TS-ESM-IMPORTS.
- The `api` package has the area `backend`, so the Express rules apply to `app/packages/api/**`.
- G-PORTS keeps agents off the developer's ports 3000 and 5173, and G-DEVSERVER refuses dev servers.
- A spec whose Context names a file under `packages/api/src/auth/` is at least `l`, which the user then confirms.

## How `cw init` writes it

`cw init` (`cli/lib/init.mjs`) takes exactly one of three modes:

| Command | What it does |
|---|---|
| `cw init --detect [--json]` | Read-only. Prints the project root, the mode, the git host, detection notes, the proposed config and the open questions. |
| `cw init --interactive [--yes] [--force]` | Asks the open questions in the terminal (`--yes` takes every default), then writes. |
| `cw init --write <config.json> [--force]` | Writes a prepared config, for example the `config` of `cw init --detect --json` saved to a file and edited. |

**Detection.** The project root is the git top level of the cwd; `cw init` refuses to run inside a nested repository that its parent ignores. A direct child directory with its own `.git` that the outer repository ignores becomes `appRoot` (in-place mode; with several, the first is proposed and `--interactive` asks); without one the mode is `worktree`. npm workspaces (plain paths and `dir/*`) become one package each, unless the root `package.json` has checks of its own; then, and without workspaces, there is one package at `.`. Areas come from dependencies (`react` → `frontend`, `express` → `backend`), else `app`. Packs and variants come from the packs' `detect` entries, checks from the `node-npm` check discovery, `moduleResolution` from `tsconfig.json`, `vitestGlobals` from a `vite`/`vitest` config with `globals: true`. `defaultBase` is `origin/HEAD`, else `origin/main` or `origin/master`, else the current branch (with a warning unless it is `main` or `master`).

**Proposal.** The detected values plus `language` `en`/`en`, preset `default` with its no-ticket key, `tickets.source` `local` with `tickets.contextPath` `docs/tickets/{key}.md`, and the defaults of `workflow`, `guards`, `complexity` and `rules` written out.

**Questions** (only those that apply): project name, repository and product-copy language, areas of a package without detected areas, a test command for a package without checks, Express `appEntry`, TypeScript `moduleResolution` when no tsconfig names it, the default base branch, the no-ticket key, the ticket source, then the Jira site (`jira`, where `-` sets none) or `contextPath` (`local`, default `docs/tickets/{key}.md`; `linear`, default `docs/specs/{key}.md`, where `-` sets none).

**Writing.** `--interactive` and `--write` refuse inside Claude Code (`CLAUDECODE=1`, exit 3), because the session protects its own settings files; run them in a terminal or through `setup.sh`. Before writing anything they validate the config (exit 1) and compile the rules in memory, so a pack or rule error writes nothing. An existing config that differs needs `--force`. Then they write:

- `.claude/dev-workflow/config.json` (an equal config keeps its bytes),
- `.claude/rules/dev-workflow/*.md` and `.claude/dev-workflow/rulebook.lock.json`,
- `.claude/settings.json`, merged additively: the packs' permissions, allow rules for the `git -C` forms the agents run (`git -C <appRoot> …` in in-place mode; none in worktree mode, where the reviewer reads the worktree with `cw review diff|log|status`, ADR 0011), an allow rule per plain check command, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`, and in worktree mode `worktree.baseRef` and `worktree.symlinkDirectories`. A differing existing value is kept and reported; `settings.local.json` is never read or written,
- a marked section in `CLAUDE.md` and `scripts/setup-dev-workflow.sh`.

## Validate and inspect

- **`cw config validate [--file <path>]`** checks the config against the schema and the cross-field rules. Without `--file` it finds the config by walking up from the cwd. Each error names the field and the problem, for example `- $.workspace.appRoot: is required for mode in-place`; invalid JSON is reported with line and column. Exit 0 when valid (with a warning per short `env` value), 1 when invalid, 3 when no config is found. It does not resolve packs: run `cw rules build` or `cw doctor` for pack ids, variants and options.
- **`cw config show [--json]`** prints the config path, the mode, the work repo, the state directory and the effective config: every default filled in, `core` first in `packs`, `env` values as `***`, and `git.conventions` as the preset id.
- The cross-field rules: `appRoot` per mode; unique package ids and paths; package paths inside the work repo; usable `testSingle` templates; no duplicate pack; an existing git preset; a compiling `keyPattern` that the no-ticket key does not match; `complexity.escalate` items with `paths` or `keywords` and compiling globs.
