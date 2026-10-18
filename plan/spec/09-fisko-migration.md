# Spec 09 — fisko migration (pilot)

Target: fisko (`~/projects/fisko`, GitHub `remklov/fisko-base`) runs the dev workflow from the `remklov` marketplace; its old agent setup is gone; no rule is lost.

## 1. Prerequisites (owner, before WP-71)

| # | What | Why |
|---|---|---|
| P1 | savvy plugins removed (WP-00), incl. the two `mcp__savvy-progress__*` permissions in fisko | No duplicate panes; decision |
| P2 | `npm ci` in `fisko-signer/` (NEXT_STEPS OPS-8) | Signer checks fail without its `node_modules`; the path goes into `isolation.symlink` |
| P3 | Remove the plaintext passwords and the Mem0 API key from `fisko/.claude/settings.local.json` and rotate them | Credentials in permission rules; `cw init` never reads this file, but it should not exist in this form |
| P4 | `git tag pre-dev-workflow` on `main` and push the tag | Rollback point |
| P5 | Main checkout on `main`, clean | Migration branch starts from it |
| P6 | Rows with a `🔄 In progress` status (2 today) settled with `cw ticket migrate-status`: each becomes a claim or goes back to `⬜ Open` | The backlog stores no in-progress state any more |

## 2. Profile — `.claude/workflow/profile.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/remklov/claude-tools/main/plugins/dev-workflow/schemas/profile.schema.json",
  "version": 1,
  "project": { "name": "fisko", "language": { "repo": "en", "productCopy": "es" } },
  "packs": [
    { "id": "core", "options": { "abbreviations": ["id", "url", "api", "req", "res", "next", "err", "props", "ref", "dte", "nit", "nrc"] } },
    "git-github",
    "node-npm",
    "typescript",
    { "id": "express", "variant": "4", "options": {
      "appEntry": "src/index.ts#default",
      "errorShape": "{ error: true, code: '<CODE>', message: '<message>' }",
      "errorMiddleware": "fisko-api/src/middleware/error.middleware.ts" } },
    { "id": "react-vite", "variant": "react-18" },
    { "id": "tailwind", "options": {
      "designDoc": "DESIGN.md", "uiKit": "fisko-app/src/styles/ui/", "globalCss": "fisko-app/src/styles/global.css" } },
    "vitest",
    { "id": "postgres-sql", "variant": "numbered-sql", "options": {
      "dir": "fisko-api/migrations", "pattern": "NNN_description.sql",
      "testDatabase": { "env": "TEST_DATABASE_URL", "service": "fisko-test-db" },
      "devDatabasePort": 5432 } },
    { "id": "docker", "options": {
      "runningStackCommands": ["make up", "make down", "docker compose up", "docker compose down", "docker compose restart"] } },
    "github-actions"
  ],
  "packages": [
    { "id": "api", "path": "fisko-api", "areas": ["backend", "data"], "docs": ["fisko-api/AGENTS.md", "docs/LESSONS.md"],
      "checks": { "typecheck": "npm run typecheck", "lint": "npm run lint", "test": "npm test" },
      "env": { "TEST_DATABASE_URL": "postgres://fisko_test:fisko_test@127.0.0.1:55433/fisko_test" },
      "services": ["fisko-test-db"], "exclusive": ["test"] },
    { "id": "signer", "path": "fisko-signer", "areas": ["backend", "security"], "docs": ["fisko-signer/AGENTS.md"],
      "checks": { "typecheck": "npm run typecheck", "test": "npm run test:coverage" } },
    { "id": "app", "path": "fisko-app", "areas": ["frontend"], "docs": ["fisko-app/AGENTS.md", "DESIGN.md"],
      "checks": { "typecheck": "npm run typecheck", "lint": "npm run lint", "test": "npm test" } },
    { "id": "shared", "path": "fisko-shared", "areas": ["shared"],
      "checks": { "build": "npm run build" }, "alsoCheck": ["api", "app"] },
    { "id": "infra", "path": ["fisko-infra", ".github/workflows"], "areas": ["infra"] },
    { "id": "kb", "path": ["docs", "plan", "PROJECT.md"], "areas": ["docs"] }
  ],
  "services": {
    "fisko-test-db": { "check": "docker inspect -f '{{.State.Running}}' fisko-test-db | grep -q true",
                       "start": "docker start fisko-test-db", "stop": "docker stop fisko-test-db", "stopIfStarted": true }
  },
  "complexity": {
    "escalate": [
      { "paths": ["fisko-signer/**"], "min": "xl", "reason": "Any change in fisko-signer is xl" },
      { "keywords": ["auth", "access grant", "grant", "certificate", "certificates", "DGII credentials", "signer"], "min": "xl", "reason": "Security-sensitive" },
      { "keywords": ["transmission", "invalidation", "contingency", "reconciliation", "F-07", "F07", "F14", "Ventas", "Compras"], "min": "l", "reason": "Changes how Fisko talks to MH or how documents land in F-07/F14 and the books" }
    ]
  },
  "split": { "mode": "builds-on", "order": ["shared", "api", "signer", "app", "infra"], "threshold": "l" },
  "isolation": {
    "mode": "worktree",
    "protectedCheckout": "~/projects/fisko",
    "symlink": ["node_modules", "fisko-api/node_modules", "fisko-app/node_modules", "fisko-signer/node_modules"]
  },
  "guards": { "ports": [3001, 5174, 5176, 5432], "commands": [], "devServer": "never" },
  "git": {
    "host": "github",
    "defaultBase": "main",
    "branch": "{ticket|lower}-{slug}",
    "branchNoTicket": "chore-{slug}",
    "commitSummary": "{summary} ({ticket})",
    "commitSummaryNoTicket": "{summary}",
    "summaryMax": 72, "summaryIdeal": 52, "bodyWrap": 72, "noTicketKey": "NO-TICKET",
    "pr": {
      "sections": [
        { "title": "What & why", "source": "spec.summary" },
        { "title": "Affected packages", "source": "classify.packages" },
        { "title": "Testing", "source": "checks" },
        { "title": "Migrations & deploy", "source": "migrations" },
        { "title": "Deploy impact", "source": "deployImpact" },
        { "title": "Open points", "source": "openPoints" },
        { "title": "Screenshots", "source": "screenshots" }
      ],
      "neverMerge": true
    }
  },
  "tickets": {
    "adapter": "markdown-table",
    "file": "plan/NEXT_STEPS.MD",
    "statusOpen": "⬜ Open",
    "dependsColumn": "Needs",
    "deleteRowWhenDone": true,
    "newRowSections": { "Normativa v2.0": "NV", "DGII integration": "DGII", "Tax filing": "TAX", "Billing and subscriptions": "BILL", "App and content": "APP", "Security": "SEC", "Operations and release gates": "OPS", "Later (roadmap)": "LATER" },
    "claims": { "backend": "git-ref", "remote": "origin", "staleHours": 24, "mergeDriver": true }
  },
  "knowledgeBase": {
    "features": "docs/FEATURES.md", "lessons": "docs/LESSONS.md", "manualTests": "docs/MANUAL_TESTS.md",
    "adr": "fisko-infra/docs/adr/", "todo": "plan/NEXT_STEPS.MD",
    "docsOnlyPaths": ["plan/**", "docs/**", "PROJECT.md"]
  },
  "domain": { "neverGuess": ["DGII/MH behaviour", "tax rules", "fiscal data structures"] },
  "workflow": { "maxReviewRounds": 3, "confirm": ["l", "xl"], "maxQuestionsPerRound": 4 },
  "rules": {
    "override": { "CORE-COMMENTS": ".claude/workflow/rules/overrides/comments.md" },
    "extend": {
      "CORE-NAMING": "MH/DGII field names keep their official Spanish spelling (`numeroControl`, `totalIva`).",
      "CORE-SECRETS": "This includes certificates, private keys, DGII credentials and `.env` files; configuration comes from environment variables, AWS Secrets Manager or GitHub Actions secrets.",
      "CORE-LOGGING": "Also never log certificates, signed DTEs, or NIT/DUI.",
      "CORE-TEST-BEHAVIOUR": "External systems are MH/DGII, the signer, S3, SES and the payment provider.",
      "EXPRESS-ERROR-RESPONSES": "A 5xx never exposes SQL or MH payloads with credentials.",
      "NPM-DEPS": "Don't 'fix' the npm audit findings that `docs/LESSONS.md` lists as known-safe."
    },
    "add": [".claude/workflow/rules/fiscal.md", ".claude/workflow/rules/ui.md"]
  }
}
```

Notes: `kb` package exists so docs-only changes map to a package (no `unowned` warnings) and orchestrator step 01 recognises docs-only tasks. The `devServer: never` guard plus ports replace the "never start a dev server on 5174/5176" prose.

## 3. Project rules

`.claude/workflow/rules/fiscal.md` (all 🔒, sources fisko CQ):

| ID | Title | Scope | Source |
|---|---|---|---|
| FISKO-DGII-SHAPES | Real DGII shapes | areas:backend | CQ-15 |
| FISKO-DTE-JSON | DTE JSON | areas:backend | CQ-25 |
| FISKO-MH-LIFECYCLE | DGII lifecycle | areas:backend | CQ-26 |
| FISKO-ACCESS | Access | areas:backend | CQ-28 |
| FISKO-SIGNER | Signer | all | CQ-23 |

`.claude/workflow/rules/ui.md`:

| ID | Title | Scope | Source |
|---|---|---|---|
| FISKO-UI-COPY | Copy and formatting | paths:`fisko-app/**` | CQ-18 (copy and formatting part; styling part is TW-DESIGN-SYSTEM) |
| FISKO-UI-DATA | Data fetching | paths:`fisko-app/**` | CQ-19 |

`.claude/workflow/rules/overrides/comments.md`: CQ-5 text ("explain why, not what. No commented-out code. No TODO comments: open work goes into `plan/NEXT_STEPS.MD` as a row; a comment may point to its ID (`see NV-9`).").

### 3.1 Coverage of the old rulebook

| Old | New |
|---|---|
| CQ-1, 2, 4, 9, 12, 16 | CORE-SCOPE, CORE-SIMPLICITY, CORE-STRUCTURE, CORE-ERRORS, CORE-TEST-SPEC, CORE-TEST-HONEST (+ VITEST-NO-FOCUS) |
| CQ-3 | CORE-NAMING + core option `abbreviations` + extend |
| CQ-5 | CORE-COMMENTS (override) |
| CQ-6 | NPM-DEPS + extend |
| CQ-7 | TS-NO-ANY + EXPRESS-INPUT-VALIDATION |
| CQ-8 | TS-NO-CAST |
| CQ-10 | EXPRESS-ASYNC-ERRORS (v4) + EXPRESS-ERROR-RESPONSES (option `errorShape`, extend) |
| CQ-11 | EXPRESS-RESPONSE-FLOW (v4) |
| CQ-13 | CORE-TEST-BEHAVIOUR (+ extend) + EXPRESS-SUPERTEST + RTL-QUERIES |
| CQ-14 | CORE-TEST-DETERMINISTIC + VITEST-TIMERS + SQL-TEST-DATABASE |
| CQ-15 | FISKO-DGII-SHAPES |
| CQ-17 | REACT-A11Y |
| CQ-18 | FISKO-UI-COPY + TW-DESIGN-SYSTEM |
| CQ-19 | FISKO-UI-DATA (+ REACT-FETCH-OK) |
| CQ-20 | CORE-SECRETS (+ extend) + VITE-ENV-SECRETS + GHA-SECRETS |
| CQ-21 | CORE-INJECTION + SQL-PARAMS |
| CQ-22 | CORE-LOGGING (+ extend) |
| CQ-23 | FISKO-SIGNER |
| CQ-24 | DOCKER-PIN + GHA-PIN + NPM-CI |
| CQ-25, 26, 28 | FISKO-DTE-JSON, FISKO-MH-LIFECYCLE, FISKO-ACCESS |
| CQ-27 | SQL-MIGRATION-COMPAT + SQL-MIGRATION-NUMBERING + SQL-NO-SCHEMA-PUSH |

Every successor carries `aliases=CQ-n` so `cw rules show CQ-n` resolves and the mapping test (WP-57) proves completeness.

## 4. Project procedures — `.claude/workflow/playbooks/`

| File | when | Content (source) |
|---|---|---|
| `orchestrator/fisko-intake.md` | phases `intake` | NEXT_STEPS rules: only `⬜ Open` tasks with done dependencies; `🔄 In progress` belongs to another session; check `docs/FEATURES.md` and grep before treating anything as missing (FO 1, NEXT_STEPS "Rules") |
| `orchestrator/fisko-handover.md` | phases `deliver` | A migration must be applied to the dev database with the owner's consent before merging (LESSONS); name manual tests from `docs/MANUAL_TESTS.md` and MH live tests; a merge to `main` deploys (deploy-impact) (FO 10–11) |
| `implementer/fisko-dgii.md` | areas `backend`; keywords DTE, MH, DGII, F-07, F14, CRE, CCFE, NCE, NDE | Never guess on MH behaviour: `plan/NORMATIVA_V2.md`, `fisko-api/src/schemas/dgii/`, `docs/LESSONS.md`; stub MH/DGII, signer, AWS at the client boundary; new DTE type registration per `fisko-api/AGENTS.md` (FG backend guidance) |
| `implementer/fisko-frontend.md` | areas `frontend` | Follow `fisko-app/AGENTS.md` and `DESIGN.md`; Spanish copy; backend only through `src/lib/` clients; never call the signer; test pure logic directly (FG frontend guidance) |
| `implementer/fisko-signer.md` | paths `fisko-signer/**` | `npm run test:coverage`; zero persistence; wipe secret buffers (FISKO-SIGNER, the signer ADRs in `fisko-infra/docs/adr/`) |
| `reviewer/fisko-fiscal-review.md` | areas `backend`; keywords as fisko-dgii | Check DTE/DGII/tax changes against the sources the spec cites and `docs/LESSONS.md`; a deviation from MH's schema or rules is blocking (category `domain`) (FR 5) |

## 5. Settings — `.claude/settings.json` (complete target)

```json
{
  "extraKnownMarketplaces": {
    "remklov": { "source": { "source": "github", "repo": "remklov/claude-tools" } }
  },
  "enabledPlugins": {
    "impeccable@impeccable": true,
    "dev-workflow@remklov": true,
    "agents-progress@remklov": true
  },
  "permissions": {
    "allow": [
      "Bash(cw *)",
      "Bash(npm test *)", "Bash(npm run test *)", "Bash(npm run test:coverage *)",
      "Bash(npm run typecheck *)", "Bash(npm run lint *)", "Bash(npm run build *)",
      "Bash(git branch -m *)", "Bash(git add *)", "Bash(git commit *)",
      "Bash(gh auth status *)", "Bash(gh pr view *)", "Bash(gh pr list *)"
    ],
    "deny": ["Agent(model:*)", "Agent(effort:*)"],
    "ask": [
      "Bash(git push *)", "Bash(gh pr create *)", "Bash(gh pr merge *)",
      "Bash(npm ci *)", "Bash(npm install *)", "Bash(npm i *)", "Bash(npm uninstall *)"
    ]
  },
  "worktree": {
    "baseRef": "head",
    "symlinkDirectories": ["node_modules", "fisko-api/node_modules", "fisko-app/node_modules", "fisko-signer/node_modules"]
  },
  "env": { "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "1" }
}
```

Removed compared with today: the `SessionStart` hook for `check-user-setup.mjs` (the plugin's hook replaces it) and the two savvy permissions. Additions from spike S8 (edit permissions or session mode) are applied here if needed.

During the pilot, `.claude/settings.local.json` (not committed) overrides the marketplace source with the local directory (spec 08 §4).

## 6. `.gitattributes`

```diff
 docs/LESSONS.md merge=union
+# Rows are merged by ticket ID (dev-workflow); driver registered in the local git config by `cw init`.
+plan/NEXT_STEPS.MD merge=dw-ticket-table
```

## 6a. `plan/NEXT_STEPS.MD`, section "Rules" (rule 2 replaced, status legend adjusted)

```markdown
2. **Claim a task before you start it.** An orchestrator session claims it
   when you say "starte mit Ticket <ID>" (or run `/dev-workflow:ticket <ID>`);
   for work by hand run `cw ticket claim <ID>`. A claim is visible at once to
   every session and machine (`cw ticket list`); this file never records who
   works on what. Only pick tasks `cw ticket list --available` shows (open,
   unclaimed, dependencies done). Work on a branch in a separate worktree,
   never by switching the main checkout: the dev stack runs whatever that
   checkout holds.
```

Status legend: `Status: ⬜ Open · ⛔ Blocked · 👤 Owner. "In progress" is shown live by cw ticket list.` Rule 1's sentence "Add a task the moment it comes up" gets the addition "with an ID from `cw ticket reserve-id <PREFIX>`".

## 6b. `.gitignore`

```diff
 .claude/*
 !.claude/agents/
 !.claude/rules/
-!.claude/hooks/
-!.claude/scripts/
 !.claude/skills/
 !.claude/settings.json
+!.claude/workflow/
```

(`!.claude/agents/` and `!.claude/skills/` stay so project-local agents or skills remain possible.)

## 7. `AGENTS.md`, section "Agent workflow" (replacement)

```markdown
### Agent workflow

<!-- dev-workflow:start -->
This repository uses the dev workflow from the `remklov` marketplace
(plugins `dev-workflow` and `agents-progress`, enabled in
`.claude/settings.json`). Run `/dev-workflow:ticket <NEXT_STEPS ID or task>`
in any session: the orchestrator writes a testable spec, classifies it,
claims the ticket (visible to every session at once), delegates to a generalist implementer in its own worktree,
runs the reviewer (up to 3 rounds) and, after your confirmation, pushes the
branch and opens the PR. It never merges.

- Stack, packages, checks, guards and git conventions: `.claude/workflow/profile.json`.
- Rules: generated into `.claude/rules/workflow/` from the profile; never edit
  them by hand. Project rules live in `.claude/workflow/rules/`; after a plugin
  update or a profile change run `cw rules build` and commit the result.
- What an agent gets: `cw playbook show <orchestrator|implementer|reviewer|investigator>`.
- Commit or discard changes to `plan/NEXT_STEPS.MD` and to files the ticket
  touches before starting it: the implementer's worktree starts from the main
  checkout's HEAD commit and sees nothing uncommitted.
<!-- dev-workflow:end -->
```

Start of a session: `claude --agent dev-workflow:orchestrator` (or `"agent": "dev-workflow:orchestrator"` in your own `.claude/settings.local.json`); then "starte mit Ticket NV-9" or "nimm das nächste Ticket" is enough. The orchestrator claims the ticket first, so parallel sessions never take the same one.

Also update the two other mentions in `AGENTS.md`: "Local Environment Safety" (worktrees sentence stays valid) and remove references to `.claude/scripts/generate-agents.mjs` and `.claude/rules/code-quality.md`.

## 8. Files

Delete: `.claude/agents/orchestrator.md`, `.claude/agents/code-reviewer.md`, `.claude/agents/{frontend,backend,infrastructure}/*-dev-*.md` (12), `.claude/scripts/generate-agents.mjs`, `.claude/rules/code-quality.md`, `.claude/hooks/check-user-setup.mjs`, `.claude/skills/ticket/SKILL.md`.

Add: `.claude/workflow/profile.json`, `.claude/workflow/rules/{fiscal,ui}.md`, `.claude/workflow/rules/overrides/comments.md`, `.claude/workflow/playbooks/**` (6 files), generated `.claude/workflow/rulebook.lock.json` and `.claude/rules/workflow/*.md`.

Change: `.claude/settings.json`, `.gitignore`, `.gitattributes`, `AGENTS.md`, `plan/NEXT_STEPS.MD` (rules section, migrated status cells).

## 9. Pilot

Branch `chore-dev-workflow-migration` in a worktree (never in the main checkout). Steps:

1. Add the files from §2–§8 except the deletions; `cw rules build`; check the §3.1 table against the generated rulebook (`cw rules show CQ-<n>` for n = 1…28).
2. Merge the branch (owner) with the old files still present but the old `/ticket` skill renamed to `/ticket-legacy` (fallback during the pilot).
3. Run three tickets in orchestrator sessions with "starte mit Ticket <ID>" (candidates as of 2026-10-18; replace any that are done by then with one of the same shape). Before the first one, a claim race test: two orchestrator sessions (this host and the laptop) get "starte mit Ticket OPS-12" at the same time; exactly one may proceed, the other must name the holder.

| Shape | Candidate | Expected path |
|---|---|---|
| s, infra | OPS-12 (run the shell tests in CI or `make test`) | implementer-s, no split |
| m, full-stack | APP-2 (per-client pending counts: API + accountant panel) | one implementer-m without split (minimum s, threshold l) |
| l, fiscal backend | NV-9 (CRE/NCE/NDE `totalIva` per Anexo II) | implementer-l, confirmation, fiscal review procedure, open point "confirm in MH test environment" |

4. Record per ticket in `plan/pilot-fisko.md` (claude-tools repo): review rounds, blocking findings by rule/category, stop-hook blocks, guard denials (from `hooks.log`), tokens per agent (pane), wall time, manual interventions, anything the owner had to fix after the PR.
5. Second commit on a new branch: delete the old files (§8), remove `/ticket-legacy`, switch `.claude/settings.local.json` back to the GitHub marketplace source.

**Pilot acceptance:** the claim race test lets exactly one session proceed; all three tickets reach an approved review; 100 % of saved reports and reviews valid; no guard denial left unexplained; every CQ-1…28 resolves to a successor; the owner accepts the PRs' quality.

**Rollback:** revert the migration merge (or reset to tag `pre-dev-workflow` on a branch and merge that); the plugin is inert without a profile.
