# Spec 04 — Base packs (release 1)

Each pack lists its options, variants, detection, rules, procedures, scripts, doctor checks, guards and permission contributions. Rule texts are ported from the two existing rulebooks — **F** = fisko `.claude/rules/code-quality.md` (CQ-1…28), **W** = `claude-workflow/.claude/rules/code-quality.md` (CQ-1…23) — and generalized: project names, paths and versions become options or move to the fisko project layer (spec 09).

Scopes: `all`, `areas:<list>`, `paths:<globs>`. Severity is `blocking` unless marked *advisory*. 🔒 = protected.

## core

- **Options:** `abbreviations` (array, default `["id","url","api","req","res","next","err","props","ref"]`), `todoFormat` (string, default `"TODO(<TICKET-KEY>): …"`).
- **Doctor:** see spec 02 `cw doctor` (all core checks live here).
- **Guards:** core guard catalog (spec 06 §4).
- **Settings:** allow `Bash(cw *)`, `Bash(git add *)`, `Bash(git commit *)`; ask `Bash(git push *)`; deny `Agent(model:*)`, `Agent(effort:*)`.

| ID | Title | Scope | Source | Generalization |
|---|---|---|---|---|
| CORE-SCOPE | Scope | all | F/W CQ-1 | as is |
| CORE-SIMPLICITY | Simplicity | all | F/W CQ-2 | as is |
| CORE-NAMING | Naming | all | F/W CQ-3 | language from `{project.language.repo}`, abbreviations from `{options.abbreviations}`; fisko's Spanish MH names via project `extend` |
| CORE-STRUCTURE | Structure | all | F/W CQ-4 | as is |
| CORE-COMMENTS | Comments | all | W CQ-5 | TODO format from `{options.todoFormat}`; fisko overrides (no TODOs) |
| CORE-ERRORS | No swallowed errors | all | F CQ-9 | includes fire-and-forget logging |
| CORE-TEST-SPEC | Coverage of the spec | all | F/W CQ-12 | as is |
| CORE-TEST-BEHAVIOUR | Test behaviour, not internals | all | F CQ-13 (generic part) | "test through public interfaces; don't mock this repo's own modules; stub external systems at their client boundary" |
| CORE-TEST-DETERMINISTIC | Deterministic, isolated tests | all | F CQ-14 (generic part) | no network out of the test process, no sleeps, restore stubs/mocks/timers |
| CORE-TEST-HONEST | Keep tests honest | all | F/W CQ-16 | framework-neutral wording ("focused or skipped tests") |
| CORE-SECRETS 🔒 | Secrets | all | F CQ-20 (generic part) | "configuration from environment, CI variables or a secret manager" |
| CORE-INJECTION 🔒 | Injection | all | F/W CQ-21 (generic part) | no HTML/shell/query building from input by concatenation |
| CORE-LOGGING 🔒 | Logging | all | F/W CQ-22 | fisko adds NIT/DUI, certificates, signed DTEs via `extend` |
| CORE-LANGUAGE | Language | all | W CLAUDE.md "Conventions" | `{project.language.repo}` for repo content, `{project.language.productCopy}` for product copy; mixed-language files reported as open point |

## git-github

- **Detect:** `origin` URL on github.com.
- **Doctor:** `gh` on PATH; `gh auth status --hostname github.com`.
- **Settings:** allow `Bash(gh auth status *)`, `Bash(gh pr view *)`, `Bash(gh pr list *)`; ask `Bash(gh pr create *)`, `Bash(gh pr merge *)`.
- **Procedures:**
  - `orchestrator/github-pr.md` (when.phases `deliver`): check auth, existing PR (`gh pr view <branch> --json url`), push the task branch (`git -C <worktree> push -u origin <branch>`), `gh pr create --repo <owner/repo from origin> --base <base> --head <branch> --title "$(cw pr title)" --body-file <pr-body.md>`, `cw pr record`, never merge. Source: fisko orchestrator step 10.
- **Rules:** none (git conventions come from the profile and `cw git lint`).

## node-npm

- **Options:** none in release 1 (`packageManager` reserved for pnpm/yarn variants).
- **Detect:** `package.json` at the root or depth ≤ 2.
- **checkDiscovery:** scripts `typecheck`/`type-check` → `npm run typecheck`, `lint` → `npm run lint`, `test` → `npm test`, `test:coverage` → offered as alternative test check.
- **Guards:** commands `npm install`, `npm i`, `npm ci`, `npm uninstall`, `npm update`, `npx npm-check-updates`, `npm audit fix`.
- **Settings:** ask `Bash(npm ci *)`, `Bash(npm install *)`, `Bash(npm i *)`, `Bash(npm uninstall *)`.
- **Scripts:** `deps-where` (backs `cw deps where`), `dependency-changes` (lists changed `dependencies`/`devDependencies` and lockfile hunks in the diff; used by `cw review scope`).

| ID | Title | Scope | Source |
|---|---|---|---|
| NPM-DEPS | Dependencies | paths:`**/package.json\|**/package-lock.json` + all imports | F CQ-6 (fisko's audit sentence goes to project `extend`) |
| NPM-CI | Reproducible installs | all | F CQ-24 (npm part) |

- **Procedures:** `investigator/dependency-trace.md` (trace behaviour in the pinned version via `cw deps where`; state traced vs. reasoned; source F orchestrator step 3), `investigator/claim-check.md` (scanner or pentest finding: verify against the lockfile versions and the code before it goes into a spec; source F orchestrator step 1).

## typescript

- **Options:** `moduleResolution` (`nodenext` | `bundler`, detected from `tsconfig.json`).
- **Detect:** `tsconfig.json` or dependency `typescript`.

| ID | Title | Scope | Source |
|---|---|---|---|
| TS-NO-ANY | No `any` | paths:`**/*.{ts,tsx,mts,cts}` | F CQ-7 (TS part): parse results go to `unknown` and are narrowed by a schema or type guard |
| TS-NO-CAST | No casts or suppressions | paths:`**/*.{ts,tsx,mts,cts}` | F/W CQ-8 |
| TS-ESM-IMPORTS | Relative imports with `.js` | paths:`**/*.{ts,mts}` | W CLAUDE.md backend convention; active only if `moduleResolution = nodenext` (rule body guarded by option, otherwise rule inactive) |

- **Procedures:** `implementer/narrow-unknown.md` (how to validate `unknown` input: zod schema if the package depends on zod, else a type guard; tests with real objects instead of casts).

## express (variants `4`, `5`)

- **Options:** `appEntry` (string, required: `"src/index.ts#app"` or `"src/app.ts#createApp()"`), `errorShape` (string, default `"{ \"error\": \"<message>\" }"`), `errorMiddleware` (path, optional).
- **Detect:** dependency `express`; variant from the major version.

| ID | Title | Scope | Variant | Source |
|---|---|---|---|---|
| EXPRESS-ASYNC-ERRORS | Async handlers forward their errors | areas:backend | 4 | F CQ-10 (first sentence; middleware path from option) |
| EXPRESS-ASYNC-ERRORS | Async handlers forward their errors | areas:backend | 5 | W CQ-10 (throw/reject, 4-parameter error handler, JSON 404) |
| EXPRESS-ERROR-RESPONSES | Error responses | areas:backend | both | F/W CQ-10 (4xx for invalid input; shape `{options.errorShape}`; 5xx never exposes internals) |
| EXPRESS-RESPONSE-FLOW | Response flow | areas:backend | 4 | F CQ-11 |
| EXPRESS-RESPONSE-FLOW | Response flow and Express 5 syntax | areas:backend | 5 | W CQ-11 |
| EXPRESS-INPUT-VALIDATION | Validate request input | areas:backend | both | F/W CQ-7 (req.body → unknown + validation; params/query format → 400) |
| EXPRESS-SUPERTEST | Test routes over HTTP | areas:backend | both | F/W CQ-13 (route part): supertest against `{options.appEntry}`, error responses included, no fixed port |

- **Procedures:** `implementer/express-route.md` (new or changed route: register in the app entry, validate input, error responses, supertest tests incl. error cases; source W backend guidance + F backend guidance).

## react-vite (variants `react-18`, `react-19`)

- **Options:** `vitestGlobals` (boolean, detected from `vitest.config.*` `globals`).
- **Detect:** dependencies `react` and `vite`; variant from the React major.

| ID | Title | Scope | Source |
|---|---|---|---|
| REACT-A11Y | Accessibility | areas:frontend | F/W CQ-17 |
| REACT-FETCH-OK | Check `response.ok` | areas:frontend | W CQ-18 |
| REACT-EFFECT-CLEANUP | Effects that fetch | areas:frontend | W CQ-19 (react-19 variant adds nothing in release 1) |
| VITE-ENV-SECRETS 🔒 | No secrets in the client bundle | areas:frontend | F/W CQ-20 (Vite part) |
| RTL-QUERIES | Query by role, label or text | areas:frontend | F/W CQ-13 (UI part) |
| RTL-CLEANUP | Testing Library cleanup | areas:frontend | W CQ-15; inactive when `vitestGlobals` is true |

- **Procedures:**
  - `implementer/ui-change.md`: function components and named exports, test beside the component; if `guards.devServer = never`, never start a dev server, verify with tests and typecheck and list what only a browser can confirm as `manual` open points (source F frontend guidance).
  - `reviewer/ui-review.md`: a11y checklist (labels, roles, alt text, keyboard reachability of new controls), copy language.

## tailwind

- **Options:** `designDoc` (path), `uiKit` (path), `globalCss` (path).
- **Detect:** dependency `tailwindcss`.

| ID | Title | Scope | Source |
|---|---|---|---|
| TW-DESIGN-SYSTEM | Use the design system | areas:frontend | F CQ-18 (styling part): UI kit `{options.uiKit}` and tokens from `{options.designDoc}`; no new classes in `{options.globalCss}` |

## vitest

- **Detect:** dependency `vitest`.
- **testRunner.single:** `npx vitest run {file}{name: -t "{name}"}`.
- **Scripts:** `no-focus` (added lines in the diff containing `.only(`, `.skip(`, `it.todo(`, `describe.only(`).

| ID | Title | Scope | Source |
|---|---|---|---|
| VITEST-NO-FOCUS | No focused or skipped tests | paths:`**/*.{test,spec}.{ts,tsx,js,jsx}` | F/W CQ-16 (part) |
| VITEST-TIMERS | Fake timers instead of waits | paths:`**/*.{test,spec}.{ts,tsx,js,jsx}` | F/W CQ-14 (timer part) |

## postgres-sql (variants `numbered-sql`, `drizzle-kit`)

- **Options:** `dir` (required), `pattern` (default `NNN_description.sql`), `testDatabase.env` (env var name), `testDatabase.service` (service id), `devDatabasePort` (int, added to guards).
- **Detect:** `**/migrations/*.sql` → `numbered-sql`; dependency `drizzle-kit` with `drizzle.config.*` and no numbered SQL → `drizzle-kit`.
- **Complexity:** paths `{options.dir}/**` → min `l`.
- **Guards:** commands `drizzle-kit push`, `npm run db:push`, `psql` with `-p {options.devDatabasePort}` or a URL containing that port.
- **Scripts:**
  - `next-number --slug <slug>`: lists `{options.dir}` at the base commit (`git ls-tree`) and in the worktree; prints the next free `NNN_<slug>.sql`.
  - `migration-check --file <f> [--base <sha>]`: number free on the base branch; name matches `pattern`; flags risky statements by regex (`DROP COLUMN`, `DROP TABLE`, `RENAME COLUMN`, `RENAME TO`, `ALTER COLUMN … TYPE`, `SET NOT NULL` without `DEFAULT` in the same statement, `ALTER TABLE … ADD COLUMN … NOT NULL` without `DEFAULT`); prints the three-question self-check with each risk pre-listed. Exit 1 on a numbering error, 0 otherwise (risks need an answer, not an automatic failure).
- **Doctor:** `test-db` — the `testDatabase.service` check passes or has a `start` command.

| ID | Title | Scope | Variant | Source |
|---|---|---|---|---|
| SQL-MIGRATION-COMPAT 🔒 | Backwards-compatible migrations | paths:`{options.dir}/**` | both | F AGENTS.md "Backwards-Compatibility Requirement" + F CQ-27 |
| SQL-MIGRATION-NUMBERING 🔒 | Numbered migration files | paths:`{options.dir}/**` | numbered-sql | F CQ-27 + AGENTS.md "Database Migrations" |
| SQL-NO-SCHEMA-PUSH 🔒 | No schema push | all | both | F CQ-27 ("No `drizzle-kit push`") |
| SQL-PARAMS 🔒 | Bound parameters | areas:backend,data | both | F CQ-21 (SQL part) |
| SQL-TEST-DATABASE | Isolated test database | areas:backend,data | both | F CQ-14 (DB part): tests only against `{options.testDatabase.env}`, never the dev database |

- **Procedures:** `implementer/sql-migration.md` (spec 01 §4 example), `reviewer/migration-review.md` (answer the self-check independently; number free on the base branch; colliding number or incompatible change is blocking; source F reviewer step 6), `orchestrator/migration-handover.md` (when.phases `deliver`: remind the owner to apply the migration to the dev database with consent before merging; never apply it; source F orchestrator step 10 + AGENTS.md).

## docker

- **Options:** `composeFiles` (array), `runningStackCommands` (array, added to guards; fisko: `make up`, `make down`, `docker compose up`, `docker compose down`, `docker compose restart`).
- **Detect:** `**/Dockerfile*`, `**/*compose*.y*ml`.
- **Scripts:** `image-pins` (changed Dockerfiles/compose files: `FROM`/`image:` without a full version tag or digest, `latest`, major-only tags).

| ID | Title | Scope | Source |
|---|---|---|---|
| DOCKER-PIN | Pinned images | paths:`**/Dockerfile*\|**/*compose*.y*ml` | F CQ-24 (container part) |

- **Procedures:** `implementer/container-change.md` (verify with `docker compose -f <file> config` or a build against a scratch tag; never touch the running stack; say what remains unverified; source F infra guidance).

## github-actions

- **Options:** `actionPinning` (`tag` | `sha`, default `tag`).
- **Detect:** `.github/workflows/*.y*ml`.
- **Scripts:** `deploy-impact [--base <sha>]`: parses every workflow with `yaml-lite`, takes `on.push` (`branches`, `paths`, `paths-ignore`), and lists the workflows a merge of the diff into `git.defaultBase` triggers. Output `{ workflows: [{ file, name, reason }] }`.

| ID | Title | Scope | Source |
|---|---|---|---|
| GHA-PIN | Pinned actions and images | paths:`.github/workflows/**` | F CQ-24 (CI part) |
| GHA-SECRETS 🔒 | Secrets in CI | paths:`.github/workflows/**` | F CQ-20 (CI part): secrets only from Actions secrets or a secret manager |

- **Procedures:** `implementer/workflow-change.md` (call out every change to what a merge deploys; say what only a workflow run can verify; source F infra guidance), `orchestrator/deploy-impact.md` (when.phases `deliver`: run `cw run github-actions:deploy-impact` and put the result into the PR's deploy section; a push to the default base that deploys needs explicit mention in the confirmation question).

## Later packs (release 2+, not part of this plan's acceptance)

| Pack | Purpose | First consumer |
|---|---|---|
| `python` (variants `uv`, `pip`) | pytest, ruff, mypy checks discovery; PY-* rules | tradarr / stockmonitor (WP-80) |
| `fastapi` | route, validation, error responses, TestClient tests | tradarr |
| `postgres-sql@alembic` | revision files, downgrade, compat rules | tradarr |
| `git-gitlab` | `glab` MR flow, doctor | GitLab-hosted projects |
| `nextjs`, `prisma`, `playwright` | | shoparr, postgen, portfolio |
| `wordpress-php` | | fisko-wp |
