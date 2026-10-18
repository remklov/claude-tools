# Spec 01 — Data contracts

Every file the workflow reads or writes has a fixed shape. JSON Schemas live in `plugins/dev-workflow/schemas/`; `cw` validates with its own dependency-free validator (spec 02, `lib/schema.mjs`), which supports exactly the keywords used here: `type`, `required`, `properties`, `additionalProperties`, `enum`, `const`, `pattern`, `items`, `minItems`, `minimum`, `maximum`, `oneOf` (for string-or-object items), `default` (documentation only).

General rules:
- JSON files: UTF-8, 2-space indent, trailing newline, written atomically (write `<file>.tmp`, then `rename`).
- Paths in profiles and packs are repository-relative POSIX paths without leading `./`.
- Identifiers: packs, packages, procedures, services: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. Rule IDs: `^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$`.
- Complexity values: `s`, `m`, `l`, `xl` (ordered).
- Roles: `orchestrator`, `implementer`, `reviewer`, `investigator`.

## 1. Profile — `.claude/workflow/profile.json`

| Field | Type | Req. | Default | Meaning |
|---|---|---|---|---|
| `$schema` | string | no | – | Editor hint only |
| `version` | `1` | yes | – | Contract version |
| `project.name` | string | yes | – | Display name |
| `project.language.repo` | string | no | `"en"` | Language of code, comments, docs, commits |
| `project.language.productCopy` | string | no | = repo | Language of user-facing product copy |
| `packs` | array | yes | – | Items: `"<id>"` or `{ "id", "variant"?, "options"? }`. `core` is implicit. Duplicates are an error |
| `packages` | array (≥1) | yes | – | See 1.1 |
| `services` | object | no | `{}` | Map service id → 1.2 |
| `complexity.escalate` | array | no | `[]` | Items `{ "paths"?: glob[], "keywords"?: string[], "min": complexity, "reason"?: string }`; at least one of `paths`/`keywords` |
| `split.mode` | `"builds-on"` \| `"parallel"` \| `"none"` | no | `"builds-on"` | How multi-package tasks are split |
| `split.order` | string[] (package ids) | no | profile order | Order of sub-tasks |
| `split.threshold` | complexity | no | `"l"` | Split is recommended only if the task's minimum complexity reaches it |
| `isolation.mode` | `"worktree"` \| `"in-place"` | no | `"worktree"` | Where implementers work |
| `isolation.protectedCheckout` | string | no | main checkout | Checkout no subagent may touch (`~` expanded) |
| `isolation.appRoot` | string | no | `"."` | In-place mode: nested repository the agents work in (e.g. `app`) |
| `isolation.symlink` | string[] | no | `[]` | Directories symlinked into worktrees; mirrored into `worktree.symlinkDirectories` by `cw init` |
| `guards.ports` | int[] | no | `[]` | Ports subagents must not bind, call or target |
| `guards.commands` | string[] | no | `[]` | Forbidden command prefixes (token-wise), or `/regex/` |
| `guards.writePaths` | glob[] | no | `[".env", ".env.*", "**/*.pem", "**/*.key"]` | Paths no workflow agent may write |
| `guards.devServer` | `"never"` \| `"allowed"` | no | `"allowed"` | Whether implementers may start dev servers |
| `git.host` | `"github"` \| `"gitlab"` \| `"none"` | no | from `origin` URL | PR/MR host |
| `git.defaultBase` | string | no | `"main"` | Base branch the main checkout must be on |
| `git.branch` | template | yes | – | Tokens: `{ticket}`, `{ticket\|lower}`, `{slug}`, `{type}` |
| `git.branchNoTicket` | template | no | = `git.branch` | Used for `noTicketKey` |
| `git.branchTypes` | string[] | no | `[]` | Allowed `{type}` values (e.g. `feature`, `bugfix`, `hotfix`) |
| `git.commitSummary` | template | yes | – | Tokens: `{summary}`, `{ticket}`, `{keyword}` |
| `git.commitSummaryNoTicket` | template | no | `"{summary}"` | |
| `git.keywords` | string[] | no | `[]` | Allowed `{keyword}` values (e.g. `[FEATURE]`, `[BUGFIX]`, `[TASK]`, `[DOCS]`); flags such as `[!!!]` go in `git.flags` |
| `git.flags` | string[] | no | `[]` | Optional prefixes before the keyword |
| `git.commitTrailers` | template[] | no | `[]` | Lines appended to every commit body (e.g. `"Relates to {ticket}"`), skipped for `noTicketKey` |
| `git.summaryMax` | int | no | `72` | Hard limit |
| `git.summaryIdeal` | int | no | – | Advisory limit (warning) |
| `git.bodyWrap` | int | no | `72` | Body wrap column (URLs and code blocks exempt) |
| `git.noTicketKey` | string | no | `"NO-TICKET"` | |
| `git.pr.sections` | array | no | see 1.3 | `{ "title", "source" }` |
| `git.pr.neverMerge` | bool | no | `true` | Orchestrator never merges |
| `git.pr.draft` | bool | no | `false` | |
| `tickets` | object | no | `{ "adapter": "none" }` | See 1.4 |
| `knowledgeBase` | object | no | – | `{ features?, lessons?, manualTests?, adr?, todo?, docsOnlyPaths?: glob[] }` |
| `domain.neverGuess` | string[] | no | `[]` | Topics where agents must ask instead of guessing (fisko: "DGII/MH behaviour", "tax rules", "fiscal data structures") |
| `workflow.maxReviewRounds` | int | no | `3` | |
| `workflow.confirm` | complexity[] | no | `["l", "xl"]` | Complexities that need user confirmation before delegation |
| `workflow.maxQuestionsPerRound` | int | no | `4` | |
| `workflow.checkTimeoutMinutes` | int | no | `15` | Per check command |
| `workflow.agentPrefix` | string | no | `"dev-workflow:"` | Prefix of the agent names `cw` hands to the orchestrator; `""` after `cw agents eject` |
| `rules` | object | no | `{}` | See 1.5 |

### 1.1 Package

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | id | yes | Unique |
| `path` | string \| string[] | yes | Owned directories (`.` allowed). A file belongs to the package with the longest matching prefix |
| `areas` | string[] (≥1) | yes | Recommended vocabulary: `frontend`, `backend`, `data`, `infra`, `shared`, `docs`, `security`, `tooling` |
| `docs` | string[] | no | Files an implementer reads before changing the package |
| `checks` | object | no | Ordered map check name → shell command, run with `cwd = <worktree>/<path[0]>`. Recommended names: `typecheck`, `lint`, `test`, `build` |
| `env` | object | no | Extra environment for checks |
| `services` | string[] | no | Service ids the checks need |
| `exclusive` | string[] | no | Check names that must not run concurrently across worktrees |
| `alsoCheck` | string[] | no | Package ids whose checks also run when this package changes |
| `test.single` | template | no | Command to run one test file (`{file}`, `{name}`); defaults to the active test-runner pack's template |

### 1.2 Service

`{ "check": cmd, "start"?: cmd, "stop"?: cmd, "stopIfStarted"?: bool }` — `check` exits 0 when the service is up. `cw checks` starts a down service if `start` exists and stops it afterwards if `stopIfStarted` and it started it.

### 1.3 PR sections

`source` values: `spec.summary` (title, ticket, context, requirements in prose), `classify.packages`, `checks` (commands actually run with results, plus proofs), `manualTests` (open points tagged `manual` and matching `knowledgeBase.manualTests` sections), `migrations` (report `migrations` + migration-check output), `deployImpact` (`github-actions:deploy-impact` output), `openPoints` (report open points + unfixed non-blocking review findings), `screenshots` (placeholder line for UI changes, only if areas include `frontend`). Empty sections are left out.

Default:

```json
[
  { "title": "What & why", "source": "spec.summary" },
  { "title": "Testing", "source": "checks" },
  { "title": "Risks & deploy steps", "source": "migrations" },
  { "title": "Open points", "source": "openPoints" }
]
```

### 1.4 Tickets

| Field | Adapter | Meaning |
|---|---|---|
| `adapter` | all | `markdown-table` \| `github-issues` \| `gitlab-issues` \| `none` |
| `file` | markdown-table | Path of the to-do file |
| `idPattern` | all | Regex for ticket IDs; default `^[A-Z]+-[0-9]+[a-z]?$` (github-issues: `^#?[0-9]+$`) |
| `columns.id`, `columns.status` | markdown-table | Header names; default `ID`, `Status` |
| `statusOpen` | markdown-table | Text of the open status; default `⬜ Open` |
| `deleteRowWhenDone` | markdown-table | The implementer deletes the row in the task branch when the ticket is fully done |
| `newRowSections` | markdown-table | Map section heading (prefix match) → ID prefix, for "New row" |
| `dependsColumn` | markdown-table | Column whose ticket IDs must be done before a ticket is available (default `Needs`) |
| `claims.backend` | all | `git-ref` (default when `origin` exists) \| `local` |
| `claims.remote` | all | Default `origin` |
| `claims.namespace` | all | Default `refs/claims` |
| `claims.idNamespace` | all | Default `refs/ticket-ids` (atomic reservation of new IDs) |
| `claims.staleHours` | all | Default `24`: a claim without update for this long and without a remote task branch counts as stale |
| `claims.mergeDriver` | markdown-table | Default `true`: `cw init` registers the row-keyed merge driver for `file` |

**"In progress" is never written to the ticket source.** The backlog holds durable states only (`⬜ Open`, `⛔ Blocked`, `👤 Owner`); who works on what lives in the claim registry (§5.4) and is shown live by `cw ticket list`, the orchestrator and the mod.

### 1.5 Rules customization

```json
{
  "disable": [{ "id": "RULE-ID", "reason": "text" }],
  "override": { "RULE-ID": "path/to/override.md" },
  "extend": { "RULE-ID": "Markdown appended as 'Project addition'" },
  "add": ["path/to/project-rules.md"],
  "options": { "RULE-ID": { "key": "value" } },
  "allowProtected": false
}
```

Disabling or overriding a rule marked `protected` requires `allowProtected: true` and a `reason`; `cw rules build` prints such rules on every run.

## 2. Pack manifest — `packs/<id>/pack.json`

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id`, `version`, `title` | string | yes | `version` is semver |
| `description` | string | no | |
| `requires` | id[] | no | Packs that must also be active (auto-added with a warning) |
| `conflicts` | id[] | no | |
| `variants` | object | no | Name → `{ "rules"?: path, "description": string, "detect"?: detect[] }` |
| `defaultVariant` | string | if variants | |
| `options` | object | no | Name → `{ "type": "string"\|"number"\|"boolean"\|"array"\|"object", "required"?, "default"?, "description" }` |
| `detect` | array | no | Items: `{ "glob" }`, `{ "dependency": npm-name, "range"? }`, `{ "file", "contains"? }` |
| `areas` | string[] | no | Typical areas (used by `cw init` to suggest package areas) |
| `rules` | path | no | Base rule file |
| `playbooks` | object | no | Role → procedure paths |
| `scripts` | object | no | Name → path of a `.mjs` file (run with `node`) |
| `doctor` | array | no | `{ "id", "script", "description" }` |
| `guards` | object | no | `{ "commands"?: [], "ports"?: [] }` merged into profile guards |
| `complexity` | array | no | Same shape as `complexity.escalate`; `{options.x}` allowed in globs |
| `checkDiscovery` | path | no | Script that prints suggested `checks` per package as JSON (used by `cw init`) |
| `testRunner` | object | no | `{ "single": template }` for `cw prove`/`cw mutate` |
| `settings` | object | no | `{ "allow"?: [], "ask"?: [], "deny"?: [] }` permission rules `cw init` adds |

## 3. Rule file grammar

```markdown
---
pack: express
variant: "4"
---

## EXPRESS-ASYNC-ERRORS — Async handlers forward their errors
<!-- rule: severity=blocking; scope=areas:backend; protected=false; aliases=CQ-10 -->
Body in Markdown, up to the next "## " heading or end of file.
```

- Heading regex: `^## ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+) (?:—|-) (.+)$`.
- Meta comment (required, directly under the heading): `<!-- rule: key=value; … -->`.
  - `severity`: `blocking` (default) or `advisory`.
  - `scope`: `all` | `areas:<a>,<b>` | `paths:<glob>|<glob>`. Globs may use `{options.x}`.
  - `protected`: `true` | `false` (default).
  - `aliases`: comma list of former IDs (e.g. `CQ-10`).
- Body placeholders: `{options.<name>}` (pack options), `{ruleOptions.<name>}` (profile `rules.options[ID]`), `{project.language.repo}`, `{project.language.productCopy}`. An unresolved placeholder is a build error.
- A variant rule file may redefine an ID from the pack's base file; the variant wins.

## 4. Procedure file — `packs/<id>/playbooks/<role>/<name>.md`, `.claude/workflow/playbooks/<role>/<name>.md`

Frontmatter:

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `name` | id | yes | Unique per role after resolution (project shadows pack with a warning) |
| `role` | role | yes | Must match the directory |
| `description` | string | yes | One line, shown in the playbook map |
| `when.paths` | glob[] | no | Applies if a task's affected paths match |
| `when.areas` | string[] | no | Applies if the task's areas intersect |
| `when.keywords` | string[] | no | Case-insensitive whole-word match in the spec title or requirements |
| `when.phases` | string[] | no | Orchestrator only: phases the procedure belongs to |
| `scripts` | string[] | no | `pack:script` the procedure uses |
| `rules` | rule-id[] | no | Rules the procedure implements |

Empty `when` means "always for this role". Body ≤ 120 lines, imperative, numbered steps.

## 5. Task state — `<git-common-dir>/dev-workflow/`

```text
dev-workflow/
├── state.json                  # index for the mod and `cw task list`
├── state.lock                  # O_EXCL lock file while writing (pid, timestamp; stale after 30 s)
├── locks/<package>-<check>.lock
├── doctor-cache.json
├── hooks.log                   # hook errors (rotated at 1 MB)
└── tasks/<task-id>/
    ├── task.json
    ├── spec.md
    ├── brief-implementer.md · brief-reviewer.md · brief-investigator.md
    ├── classify.json
    ├── checks-<timestamp>.json · checks-<timestamp>/<package>-<check>.log
    ├── proofs.json
    ├── report-<round>.json · review-<round>.json · investigation.json
    └── pr-body.md
```

Task id = branch name with `/` replaced by `__`.

### 5.1 `task.json`

```json
{
  "version": 1,
  "id": "nv-9-cre-totaliva",
  "ticket": "NV-9",
  "title": "Fix the CRE and NCE/NDE totalIva",
  "type": "bugfix",
  "phase": "review",
  "round": 2,
  "complexity": "l",
  "complexityOverride": null,
  "areas": ["backend"],
  "packages": ["api"],
  "branch": "nv-9-cre-totaliva",
  "buildsOn": null,
  "parent": null,
  "subtasks": [],
  "base": { "branch": "main", "commit": "0aabc36…" },
  "worktree": "/home/dispatcher/projects/fisko/.claude/worktrees/agent-1a2b",
  "agents": {
    "implementer": { "id": "a1b2c3", "type": "dev-workflow:implementer-l", "description": "NV-9 · Fix the CRE and NCE/NDE totalIva" },
    "reviewer": { "id": "d4e5f6", "type": "dev-workflow:reviewer", "description": "Review · NV-9 · Fix the CRE and NCE/NDE totalIva" }
  },
  "steps": { "done": 5, "total": 9, "note": "checks" },
  "claim": { "ref": "refs/claims/NV-9", "sha": "<commit of the claim payload>", "since": "2026-10-18T09:00:00Z" },
  "prUrl": null,
  "outcome": null,
  "stopAttempts": {},
  "history": [{ "at": "2026-10-18T09:12:00Z", "from": "classify", "to": "confirm", "note": "" }],
  "createdAt": "2026-10-18T09:00:00Z",
  "updatedAt": "2026-10-18T09:40:00Z"
}
```

### 5.2 `state.json`

```json
{
  "version": 1,
  "updatedAt": "2026-10-18T09:40:00Z",
  "tasks": [
    { "id": "nv-9-cre-totaliva", "ticket": "NV-9", "title": "…", "phase": "review", "round": 2,
      "maxRounds": 3, "complexity": "l", "areas": ["backend"], "prUrl": null,
      "agents": { "implementer": "a1b2c3", "reviewer": "d4e5f6" },
      "descriptions": { "implementer": "NV-9 · …", "reviewer": "Review · NV-9 · …" },
      "steps": { "done": 5, "total": 9, "note": "checks" }, "parent": null }
  ]
}
```

Only tasks whose phase is not `done`/`aborted`, plus those that ended within the last 10 minutes, are listed.

### 5.3 Phases and transitions

```text
spec ──► classify ──► confirm ──► implement ──► review ──► deliver ──► done
            │  ▲          │            ▲  │          │
            │  └──────────┼────────────┘  │          ├──► escalated ──► implement | aborted
            └─────────────┴──► implement  │          │
                         (s/m, not in workflow.confirm)└──► implement (changes_requested, round+1)
any non-final phase ──► aborted
```

| Transition | Precondition checked by `cw` |
|---|---|
| `spec → classify` | `cw spec lint` passes |
| `classify → confirm/implement` | complexity set and ≥ minimum (or override with reason) |
| `confirm → implement` | confirmation recorded (`cw task confirm`) |
| `→ spec` (`cw task new`) | this session holds the ticket's claim (not for `noTicketKey`) |
| `→ implement` (start) | base recorded, claim still held by this session, brief rendered |
| `implement → classify` | report with status `misclassified` saved |
| `implement → review` | report for current round with status `done` saved and valid |
| `review → implement` | review for current round saved with `changes_requested`; new round ≤ max |
| `review → escalated` | `changes_requested` and round = max |
| `review → deliver` | review for current round `approved` |
| `deliver → done` | `prUrl` set, or `--no-pr <reason>` |
| `escalated → implement` | user decision recorded (`--note`) |

### 5.4 Claims (who works on which ticket)

Claims make "in progress" visible to every session, worktree, machine and cloud session at once, and make taking a ticket atomic.

**Backend `git-ref` (default).** One ref per ticket on the remote: `refs/claims/<TICKET-ID>`. It points to a parentless commit whose tree holds one file `claim.json`:

```json
{
  "version": 1,
  "ticket": "NV-9",
  "title": "Fix the CRE and NCE/NDE totalIva",
  "phase": "review",
  "round": 2,
  "branch": "nv-9-cre-totaliva",
  "task": "nv-9-cre-totaliva",
  "holder": { "host": "dispatcher", "user": "dispatcher", "session": "<session id or pid-based id>", "checkout": "/home/dispatcher/projects/fisko" },
  "since": "2026-10-18T09:00:00Z",
  "updatedAt": "2026-10-18T09:40:00Z"
}
```

| Operation | Git mechanics | Atomicity |
|---|---|---|
| Acquire | build blob → tree → `git commit-tree` (no parent); `git push --force-with-lease=refs/claims/<ID>: <remote> <sha>:refs/claims/<ID>` (empty lease value = the ref must not exist) | The remote accepts exactly one creator; the loser gets a rejected push |
| Update (phase change) | new payload commit; `git push --force-with-lease=refs/claims/<ID>:<old sha> <remote> <new sha>:refs/claims/<ID>` | Fails if someone else changed or stole the claim |
| Release | `git push --force-with-lease=refs/claims/<ID>:<old sha> <remote> :refs/claims/<ID>` | Only the holder's version is deleted |
| List | `git fetch --prune <remote> '+refs/claims/*:refs/dw/claims/*'`, then `git cat-file -p refs/dw/claims/<ID>:claim.json` | Read-only |
| Steal (stale only, after user confirmation) | update with lease on the stale sha; payload records `stolenFrom` | As update |

A claim ends when (a) the task is aborted (release), or (b) the ticket's row no longer exists on `<remote>/<defaultBase>` (the PR that deleted it was merged) — `cw ticket gc` removes those and runs inside `cw intake` and `cw ticket list`. A claim whose `updatedAt` is older than `staleHours` and whose branch does not exist on the remote is shown as **stale**.

**ID reservation.** A new backlog row (orchestrator "New row", implementer adding a follow-up to-do) reserves its ID first: `refs/ticket-ids/<ID>` is created with the same empty-lease push; on rejection the next number is tried. Reserved IDs are never reused.

**Backend `local`** (no remote, or offline): the same JSON in `<common-dir>/dev-workflow/claims/<ID>.json`, created with `O_EXCL`. Visible to every worktree and session on the same machine only. When a `git-ref` push fails for network reasons, `cw` falls back to `local`, marks the claim `unsynced`, warns, and pushes it on the next `cw` call that reaches the remote; if the remote then holds a different claim, the local one is reported as a conflict and the orchestrator stops.

## 6. Spec — `tasks/<id>/spec.md`

```markdown
## Task: <title>
**Ticket:** <ID or NO-TICKET> · **Type:** <feature|bugfix|chore> · **Complexity:** <s|m|l|xl>
**Branch:** <branch> · **Builds on:** <branch or —>

### Context
<why; affected modules and files as `backticked/paths`; the plan, manual or doc that settles the rules>

### Requirements
- R1 …

### Acceptance criteria
- [ ] AC1 … (testable)

### Non-goals
- …

### Definition of done
- Checks of every affected package pass (`cw checks --changed`)
- Rules of the compiled rulebook are met
- <knowledge-base duties from the profile, if any>
```

`cw spec lint` rules:
1. All five sections present, in order; header lines parse.
2. ≥1 requirement `R<n>`, ≥1 acceptance criterion `AC<n>`; numbering contiguous.
3. Every AC contains a verifiable verb phrase (heuristic: not only "should work", "is correct", "properly"); flagged ACs are warnings.
4. No AC asks that "every test fails on the unfixed code" (fisko lesson); only regression tests fail on unfixed code.
5. Rule references use rulebook IDs that exist; quoted rule text matches the rulebook verbatim.
6. No attribution lines (`Co-Authored-By`, `Generated with`).
7. Branch matches `git.branch`/`git.branchNoTicket`; slug matches `^[a-z0-9]+(-[a-z0-9]+){1,3}$`.
8. Backticked paths in Context exist at HEAD of the base (warning if not, since a new file is possible).

## 7. Classification — `tasks/<id>/classify.json`

```json
{
  "paths": ["fisko-api/src/modules/dte/builders/cre-builder.ts"],
  "packages": ["api"],
  "areas": ["backend"],
  "minComplexity": "s",
  "reasons": ["no escalation rule matched; minimum is s"],
  "chosen": "l",
  "justification": "Changes the DTE JSON that MH validates in three builders (orchestrator).",
  "override": null,
  "splitRecommended": false,
  "order": ["api"],
  "procedures": { "implementer": ["postgres-sql/sql-migration"], "reviewer": ["fisko/fisko-fiscal-review"] },
  "agent": "dev-workflow:implementer-l"
}
```

## 8. Dev report — `report-<round>.json`

Produced by `cw report save` (agent JSON on stdin merged with fields `cw` fills itself). The implementer's final message is exactly the JSON `cw report save` prints, in one ```json block.

```json
{
  "kind": "dev-report",
  "version": 1,
  "task": "nv-9-cre-totaliva",
  "round": 1,
  "status": "done",
  "branch": "nv-9-cre-totaliva",
  "worktree": "/abs/path",
  "head": "<sha>",
  "changedFiles": ["…"],
  "acceptanceCriteria": [{ "id": "AC1", "met": true, "evidence": "cre-builder.test.ts › writes the IVA of the subject amount" }],
  "proofs": [{ "test": "fisko-api/src/…/cre-builder.test.ts:writes the IVA…", "command": "…", "failedWithout": true, "failureLine": "AssertionError: expected 13 to be 1", "passesWith": true }],
  "checks": { "file": "checks-20261018T094000Z.json", "overall": "pass" },
  "migrations": "none",
  "docs": ["docs/FEATURES.md"],
  "openPoints": [{ "text": "Confirm in MH's test environment", "tag": "manual" }],
  "blocked": null,
  "misclassified": null
}
```

Filled by `cw`: `branch`, `worktree`, `head`, `changedFiles`, `proofs` (from `proofs.json`), `checks` (latest checks file of this round). Validation: `status=done` ⇒ every AC from the spec present, `checks.overall=pass`, every AC with `met=true` has evidence; `blocked` set iff `status=blocked` (`{ "question", "needed" }`); `misclassified` set iff `status=misclassified` (`{ "reason", "suggested": { "complexity"? }, "branchCreated", "dirty" }`).

## 9. Review — `review-<round>.json`

```json
{
  "kind": "review",
  "version": 1,
  "task": "nv-9-cre-totaliva",
  "round": 1,
  "status": "changes_requested",
  "checks": [{ "package": "api", "check": "test", "command": "npm test", "result": "pass" }],
  "acceptanceCriteria": [{ "id": "AC1", "met": true, "evidence": "…" }],
  "mutations": [{ "test": "…", "removed": "cre-builder.ts:41-44", "killed": true }],
  "rulesChecked": ["CORE-SCOPE", "TS-NO-CAST", "FISKO-DTE-JSON"],
  "findings": [
    { "id": "F1", "severity": "blocking", "rule": "FISKO-DTE-JSON", "file": "…", "line": 52,
      "issue": "…", "suggestion": "…" }
  ]
}
```

`rule` is a rule ID from `rulesChecked` or one of `spec`, `scope`, `git`, `docs`, `migration`, `correctness`, `security`, `domain`. A non-blocking finding may carry `"sendAlong": true` when it is cheap (a few lines in files the change already touches) or corrects something on the record (a test gap, a wrong sentence in the docs); `cw task return` sends those together with the blocking ones. Validation: `approved` ⇒ no blocking finding, all checks `pass`, all ACs met, every mutation killed. `rulesChecked` must equal the set `cw rules applicable --task` returns (missing IDs are an error).

## 10. Investigation — `investigation.json`

```json
{
  "kind": "investigation",
  "version": 1,
  "task": "…",
  "question": "…",
  "findings": [{ "claim": "…", "evidence": "file:line or command output", "basis": "traced" }],
  "rootCause": "…",
  "options": [{ "title": "…", "tradeoffs": "…", "effort": "s" }],
  "recommendation": "…",
  "briefAdditions": "Markdown the orchestrator merges into the spec"
}
```

`basis` is `traced` (observed in code or a run) or `reasoned` (inferred).

## 11. Checks result — `checks-<timestamp>.json`

```json
{
  "kind": "checks",
  "base": "<sha>", "head": "<sha>",
  "changedFiles": 7, "unowned": ["README.md"],
  "services": [{ "id": "fisko-test-db", "wasUp": false, "started": true, "stopped": true }],
  "packages": [
    { "id": "api", "reason": "changed",
      "checks": [{ "name": "typecheck", "command": "npm run typecheck", "cwd": "fisko-api",
                   "exit": 0, "durationMs": 8123, "result": "pass", "log": "checks-…/api-typecheck.log", "tail": "…" }] }
  ],
  "overall": "pass"
}
```

## 12. Rulebook lock — `.claude/workflow/rulebook.lock.json`

```json
{
  "version": 1,
  "generator": { "plugin": "dev-workflow", "version": "1.0.0" },
  "profileHash": "sha256:…",
  "packs": [{ "id": "express", "version": "1.0.0", "variant": "4", "source": "plugin" }],
  "rules": [{ "id": "EXPRESS-ASYNC-ERRORS", "source": "express@4", "hash": "sha256:…", "aliases": ["CQ-10"],
              "protected": false, "modified": "extend" }],
  "outputs": [{ "file": ".claude/rules/workflow/area-backend.md", "hash": "sha256:…" }]
}
```

## 13. Hook context (`SubagentStart` output)

Plain Markdown, ≤ 6,000 characters, factual statements only:

```markdown
dev-workflow context (profile: .claude/workflow/profile.json, plugin 1.0.0)
Role: implementer. Task briefs live in <common-dir>/dev-workflow/tasks/<id>/; your prompt names yours.
Packages: api → fisko-api (backend, data; checks: typecheck, lint, test [exclusive]) · app → fisko-app (frontend) · …
Procedures for this role: sql-migration (postgres-sql; when: fisko-api/migrations/**) — <path> · fisko-dgii (project; when: areas backend) — <path> · …
Guards: ports 3001, 5174, 5176, 5432; commands: make up, make down, drizzle-kit push, npm install…; no dev server.
Scripts: run `cw help` for the command list; pack scripts via `cw run <pack>:<script>`.
```
