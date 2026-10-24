# Stack packs

A pack holds what the dev workflow knows about one part of a stack: rules, procedures, scripts, permissions and guards. The plugin ships six packs in `plugins/dev-workflow/packs/`; a project activates them in its [config](config.md) and can add its own (`docs/PLAN.md` §7). The code is `cli/lib/packs.mjs` (resolution, detection, scripts, procedures) and `cli/lib/rules.mjs` (the rules engine).

## What a pack is

```text
packs/<id>/
  pack.json                 the manifest (schemas/pack.schema.json)
  rules.md                  the base rule file, named by "rules"
  rules.<variant>.md        a variant's rule file, named by variants.<name>.rules
  procedures/<role>/*.md    procedures; the role is orchestrator, implementer or reviewer
  scripts/*.mjs             scripts, run with cw run <pack>:<script>
```

| Manifest field | Meaning |
|---|---|
| `id`, `version`, `title` | Required. The id equals the directory name; `version` is semver and recorded in the rulebook lock. |
| `description` | One line. |
| `requires`, `conflicts` | Pack ids this pack needs, or cannot run with. |
| `detect` | Any-of entries for `cw init`: `{ "glob": … }` (a file of the work repo) or `{ "dependency": … }` with an optional `"major"` (in a `package.json`). |
| `areas` | The areas the pack is about. `cw init` does not use them: package areas come from the dependencies. |
| `variants`, `defaultVariant` | Named variants, each with a `description`, an optional `rules` file and its own `detect`. The default applies when the config names none. |
| `options` | Typed options (`string`, `number`, `boolean`, `array`, `object`), each with a `description` and a `default` or `required`. `{options.x}` in the pack's rules, procedures, guard commands and complexity paths. |
| `rules` | The base rule file. |
| `scripts` | Name → `scripts/<file>.mjs`. |
| `checkDiscovery` | The script `cw init` runs to propose the packages' checks. |
| `scopeScripts` | Scripts that `cw review scope` runs (reviewer step R1). |
| `testRunner.single` | The single-test command for `cw prove`: `{file}`, and `{name}` only inside an optional `[ … ]` segment. |
| `guards` | `dependencyCommands` (G-DEPS), `commands` (G-COMMANDS), `ports` (G-PORTS). |
| `settings` | `allow`, `ask` and `deny` permission rules that `cw init` merges into `.claude/settings.json`. |
| `complexity.escalate` | Minimum complexities, the same items as the config's `complexity.escalate`. |

Procedures are found by directory, not listed in the manifest; their format is in [playbooks](playbooks.md#procedures). Beyond the schema, `cw` checks that the id equals the directory, `defaultVariant` names a variant, `checkDiscovery` and `scopeScripts` name scripts, defaults match their option type, every named file exists, `testRunner.single` is a usable template, and the `detect` globs and complexity paths compile.

## Rule files

```markdown
## RULE-ID — Title
<!-- rule: severity=blocking; scope=areas:backend; protected=false -->
Body until the next "## ".
```

- The ID is uppercase words joined by hyphens, at least two (`CORE-SCOPE`). `—` or `-` separates it from the title.
- The meta line sits directly under the heading, and the body must not be empty. Frontmatter and text before the first heading are ignored.

| Meta key | Values | Default |
|---|---|---|
| `severity` | `blocking`, `advisory` | `blocking` |
| `scope` | `all`, `areas:<a>,<b>`, `paths:<glob>\|<glob>` | `all` |
| `protected` | `true`, `false` | `false` |
| `when` | `option:<name>` or `option:<name>=<value>` | always active |

- **Placeholders:** `{options.x}` (the pack's options), `{ruleOptions.x}` (the config's `rules.options.<ID>`), `{project.name}`, `{project.language.repo}`, `{project.language.productCopy}`. An unresolved placeholder is a build error.
- **`when`** makes a pack rule depend on a pack option: without a value it is active when the option is on (true or a non-empty list), with a value when the option equals it, case-insensitive. Otherwise the rule is inactive.
- **Protected** rules win over the spec; disabling or overriding one needs `rules.allowProtected` in the config ([config](config.md)).
- **Project rules** use the same grammar: every `.claude/dev-workflow/rules/*.md` plus the files in `rules.add`. They take a project prefix (a pack prefix such as `CORE-` gives a warning) and have no `{options.…}` and no `when`.

## How packs become active

The active packs, in layer order (`resolvePacks`):

1. `core`, always first.
2. Each entry of the config's `packs` in order, each after the packs it `requires`. A required pack that the config does not list is added with a warning.
3. Two active packs where one `conflicts` with the other are an error.

For each pack, the variant is the config's `variant`, else the `defaultVariant`; a pack with variants and neither is an error, and a pack without variants refuses a `variant`. Given options are type-checked, missing ones take their default, and a required option without a value or an unknown option is an error. All problems come in one error (exit 1) that names the config.

A project-local pack in `.claude/dev-workflow/packs/<id>/` is found before the bundled pack of the same id, with a warning when it shadows it. It keeps the bundled pack's protected rules: dropping one needs `rules.allowProtected`.

No v1 pack declares `requires` or `conflicts`; the mechanism is there for later packs.

**Detection in `cw init`.** Every available pack (bundled and project-local, in id order) whose `detect` has a hit is proposed; `core` is never listed. A glob is matched against the work repo's tracked and untracked, not ignored files. A dependency is looked up in `dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies` of the root and workspace `package.json` files; `major` matches a range that starts with that version (`^5.1.0`, `~5`, `5.x`). The variant whose own `detect` hits is chosen; without one the default variant applies and `cw init` warns.

## What packs contribute

| Contribution | Used by |
|---|---|
| Rules | `cw rules build`, compiled into `.claude/rules/dev-workflow/` (below) |
| Procedures | The briefs of `cw task start`, `cw task review` and `cw task return`, selected per task |
| `settings` | `cw init`, which merges the active packs' permission rules into `.claude/settings.json` |
| `guards` | The PreToolUse guards for workflow agents, together with the config's `guards` |
| `testRunner.single` | `cw prove`; the last active pack that declares one wins, and `packages[].testSingle` overrides it |
| `scripts` | `cw run <pack>:<script>` |
| `scopeScripts` | `cw review scope`: exit 1 is a finding; another exit or a timeout means the script did not finish its check |
| `checkDiscovery` | `cw init`, which expects a JSON object `{ "<package dir>": { "<check>": "<command>" } }` on stdout |
| `complexity.escalate` | `cw classify`, together with the config's items |

`cw run <pack>:<script> [--task <id>] [--base <ref>] [-- <args>]` runs `node <script>` in the task's work tree (without `--task`, in the work repo), with a timeout of 10 minutes; output and exit code pass through. The script gets `CW_WORK_TREE`, `CW_CONFIG_ROOT`, `CW_PACK_OPTIONS` (JSON), `CW_TASK`, `CW_TASK_DIR`, `CW_BASE` (the task's base commit, or `--base`), `CW_DEFAULT_BASE` and `CW_PACKAGE_DIRS` (a JSON array of the package paths).

## Compiling the rules

`cw rules build` (`buildRulebook`, `writeRulebook`) layers the rules and writes them for Claude Code:

1. **Packs** in layer order, each with its base file and then its variant file. A variant file may redefine a base rule of its own pack, which keeps its position; any other duplicate ID is an error.
2. **Project** rule files.
3. **Conditions:** a `when` that does not match, or an `areas:` scope that no package has, makes a rule inactive.
4. **Customizations** from the config: `override`, then `extend`, then `disable`. Unknown IDs in `override`, `extend`, `disable` or `options` are errors.
5. **Placeholders** are filled in, and each scope becomes globs: `paths:` globs as written, `areas:` as `<package path>/**/*` for every package with one of the areas (`**/*` for the package `.`).

Every problem is collected into one error (exit 1); nothing is written then.

| Output in `.claude/rules/dev-workflow/` | Holds | `paths:` frontmatter |
|---|---|---|
| `00-global.md` | The preamble, every `scope=all` rule, and the disabled rules with their reasons | none; in in-place mode `<appRoot>/**` |
| `area-<a>[+<b>].md` | The `areas:` rules, one file per set of areas | the packages' globs |
| `paths-<pack>-<n>.md` | The `paths:` rules, one file per glob list, numbered per pack | the rule's globs |

- In in-place mode every glob gets the `<appRoot>/` prefix, so sessions in the outer repository get the application's rules only for files under `appRoot`.
- The preamble says the spec wins over a rule, except for protected rules, and names `cw rules applicable --task <id>`.
- Every file carries a marker line (`Generated by dev-workflow (cw rules build)`) and its sources. Unchanged files are left alone, marked files that are no longer generated are deleted, and an unmarked file at an output path is refused. A file over 12 KB gives a warning.
- The lock `.claude/dev-workflow/rulebook.lock.json` records the plugin version, the packs (id, version, variant, source), each rule (id, title, source, severity, scope, protected, a hash, and `modified` for an override or extension), the inactive and disabled rules, and the hash of each output. Commit it with the output.

**Drift.** `cw rules build --check` builds in memory, compares the result with the lock and the files, and writes nothing. It exits 1 and lists every problem: no lock, a rule added, removed or changed, a missing file, a file edited by hand, a file out of date (for example after a package path changed), a stale file. A plugin or pack version change alone is only a note. `cw doctor` and the SessionStart hook report drift as a warning and rules that do not compile as an error.

| Command | What |
|---|---|
| `cw rules build [--check] [--json]` | Compile and write, or check for drift |
| `cw rules list [--json]` | The active rules: id, severity (with `protected`), scope, source (`express@5` for a variant rule), title |
| `cw rules show <ID> [--json]` | One rule with its full text; a disabled or inactive rule exits 1 with the reason |
| `cw rules applicable --task <id> [--json]` | The global rules plus the scoped rules that match the task's changed files (since its base, in its work tree) or its areas, with full text. The reviewer's `rulesChecked` and that of a done implementer report must equal this set. |

## The v1 packs

| Pack | Detected by | Variants | Procedures | Scripts |
|---|---|---|---|---|
| `core` | always active | – | – | – |
| `node-npm` | `package.json`, `*/package.json` | – | – | `check-discovery`, `dependency-changes` |
| `typescript` | `tsconfig.json`, `*/tsconfig.json`, dependency `typescript` | – | `implementer/narrow-unknown` | – |
| `express` | dependency `express` | `4`, `5` (default) | `implementer/express-route` | – |
| `react-vite` | dependency `react` | `react-18`, `react-19` (default) | `implementer/ui-change`, `reviewer/ui-review` | – |
| `vitest` | dependency `vitest` | – | – | `no-focus` |

Every v1 rule is `blocking`; the protected ones are marked. Packs without `settings` or `guards` add none.

### core

Stack-neutral code quality, testing and security rules. Always active; the config need not list it.

Options: `abbreviations` (array, default `id, url, api, req, res, next, err, props, ref`), used by CORE-NAMING; `todoFormat` (string, default `TODO(<TICKET-KEY>): …`), used by CORE-COMMENTS. CORE-NAMING and CORE-LANGUAGE also use the project languages.

| Rule | Title | Severity | Scope |
|---|---|---|---|
| CORE-SCOPE | Scope | blocking | all |
| CORE-SIMPLICITY | Simplicity | blocking | all |
| CORE-NAMING | Naming | blocking | all |
| CORE-STRUCTURE | Structure | blocking | all |
| CORE-COMMENTS | Comments | blocking | all |
| CORE-ERRORS | No swallowed errors | blocking | all |
| CORE-TEST-SPEC | Coverage of the spec | blocking | all |
| CORE-TEST-BEHAVIOUR | Test behaviour, not internals | blocking | all |
| CORE-TEST-DETERMINISTIC | Deterministic, isolated tests | blocking | all |
| CORE-TEST-HONEST | Keep tests honest | blocking | all |
| CORE-DEPENDENCIES | Dependencies | blocking | all |
| CORE-REPRODUCIBLE-BUILDS | Reproducible builds | blocking | `**/Dockerfile*`, `**/*compose*.y*ml`, `.github/workflows/**`, `**/.gitlab-ci.yml` |
| CORE-LANGUAGE | Language | blocking | all |
| CORE-SECRETS | Secrets | blocking, **protected** | all |
| CORE-INJECTION | Injection | blocking, **protected** | all |
| CORE-LOGGING | Logging | blocking, **protected** | all |

Settings: allow `Bash(cw *)`, `Bash(git add *)`, `Bash(git commit *)`; ask `Bash(git push *)`, `Bash(git -C * push *)`, `Bash(gh pr create *)`, `Bash(glab mr create *)`; deny `Agent(model:*)`, `Agent(effort:*)`.

### node-npm

npm workspace rules, the check discovery for `cw init`, and the dependency scan for the reviewer.

| Rule | Title | Severity | Scope |
|---|---|---|---|
| NPM-WORKSPACE-IMPORTS | Workspace imports | blocking | `**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}` |
| NPM-CI | Reproducible installs | blocking | `**/Dockerfile*`, `**/*compose*.y*ml`, `.github/workflows/**`, `**/.gitlab-ci.yml`, `**/Makefile`, `**/*.sh` |

- **`check-discovery`** (`checkDiscovery`): reads the `scripts` of each package's `package.json` and proposes `test: npm test` (unless the test script is npm's "no test specified" placeholder), `typecheck: npm run typecheck` (or `type-check`) and `lint: npm run lint`.
- **`dependency-changes`** (scope script): lists every change in the dependency blocks of a `package.json` and every changed `package-lock.json` or `npm-shrinkwrap.json` between the base and HEAD; exit 1 when there is one (CORE-DEPENDENCIES).
- **Guards** (`dependencyCommands`, G-DEPS): `npm install`, `npm ci`, `npm uninstall`, `npm update`, `npm install-test`, `npm audit fix` and their aliases, misspellings included (`npm i`, `npm add`, `npm rm`, `npm up`, `npm isntall`, …).
- **Settings:** ask for the install, clean-install, uninstall and install-test commands and their aliases (`Bash(npm ci *)`, `Bash(npm install *)`, `Bash(npm i *)`, `Bash(npm uninstall *)`, …). `npm update` and `npm audit fix` are guarded but have no ask rule.

### typescript

Rules against `any`, casts and suppressions, the `.js` import rule for NodeNext, and the narrow-unknown procedure.

Option: `moduleResolution` (string, default `bundler`). `cw init` reads it from `tsconfig.json` and asks when no tsconfig names it.

| Rule | Title | Severity | Scope |
|---|---|---|---|
| TS-NO-ANY | No `any` | blocking | `**/*.{ts,tsx,mts,cts}` |
| TS-NO-CAST | No casts or suppressions | blocking | `**/*.{ts,tsx,mts,cts}` |
| TS-ESM-IMPORTS | Relative imports with `.js` | blocking | `**/*.{ts,mts}`; active only with `moduleResolution` `nodenext` |

Procedure `implementer/narrow-unknown`: validate untyped input instead of casting it. Triggered by the keywords body, payload, json, parse, response, input, webhook, import; applies TS-NO-ANY and TS-NO-CAST.

### express

Error handling, input validation, response flow and HTTP tests for Express 5 and 4. Variant `4` is chosen for an `express` dependency of major 4, `5` for major 5; the default is `5`.

Options: `appEntry` (string, **required**: the expression tests use to get the app without listening, for example `createApp()`; `cw init` proposes `createApp()` and asks), `errorShape` (string, default `{ "error": "<message>" }`), `errorMiddleware` (string, default `the error middleware`, used by the Express 4 rules).

| Rule | Title | Severity | Scope | File |
|---|---|---|---|---|
| EXPRESS-ERROR-RESPONSES | Error responses | blocking | `areas:backend` | `rules.md` |
| EXPRESS-INPUT-VALIDATION | Validate request input | blocking | `areas:backend` | `rules.md` |
| EXPRESS-SUPERTEST | Test routes over HTTP | blocking | `areas:backend` | `rules.md` |
| EXPRESS-ASYNC-ERRORS | Async handlers forward their errors | blocking | `areas:backend` | `rules.v4.md`, `rules.v5.md` |
| EXPRESS-RESPONSE-FLOW | Response flow (4) · Response flow and Express 5 syntax (5) | blocking | `areas:backend` | `rules.v4.md`, `rules.v5.md` |

Procedure `implementer/express-route`: add or change a route with validation, error responses and HTTP tests. Triggered by the area `backend` or the keywords route, endpoint, api, handler, middleware, request; applies the five Express rules.

### react-vite

Accessibility, fetching, effect, raw-HTML and client-secret rules, the Testing Library rules, and the UI procedures. Variant `react-18` or `react-19` follows the major of the `react` dependency; the default is `react-19`. The variants have no rule files of their own.

Option: `vitestGlobals` (boolean, default `false`). `cw init` sets it to `true` when a `vite` or `vitest` config sets `globals: true`.

| Rule | Title | Severity | Scope |
|---|---|---|---|
| REACT-A11Y | Accessibility | blocking | `areas:frontend` |
| REACT-FETCH-OK | Check `response.ok` | blocking | `areas:frontend` |
| REACT-EFFECT-CLEANUP | Effects that fetch | blocking | `areas:frontend` |
| REACT-NO-RAW-HTML | No raw HTML | blocking, **protected** | `areas:frontend` |
| VITE-ENV-SECRETS | No secrets in the client bundle | blocking, **protected** | `areas:frontend` |
| RTL-QUERIES | Query by role, label or text | blocking | `areas:frontend` |
| RTL-CLEANUP | Testing Library cleanup | blocking | `areas:frontend`; active only with `vitestGlobals` `false` |

Procedures, both triggered by the area `frontend`: `implementer/ui-change` (components, states, tests, and how to verify without a browser) and `reviewer/ui-review` (accessibility, state and copy checks).

### vitest

Rules against focused tests and sleeps, the single-test command for `cw prove`, and the no-focus scan for the reviewer.

| Rule | Title | Severity | Scope |
|---|---|---|---|
| VITEST-NO-FOCUS | No focused or skipped tests | blocking | `**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}` |
| VITEST-TIMERS | Fake timers instead of waits | blocking | `**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}` |

- **Test runner:** `npx vitest run {file} [-t "{name}"]`.
- **`no-focus`** (scope script): finds `.only`, `.skip` and `.todo` on `it`, `test`, `describe` or `suite` in the lines added to `*.test.*` and `*.spec.*` files between the base and HEAD; exit 1 with the hits (VITEST-NO-FOCUS).
