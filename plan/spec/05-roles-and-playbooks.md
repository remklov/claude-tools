# Spec 05 — Roles, agents and playbooks

Sources: **FO** = fisko `orchestrator.md`, **FR** = fisko `code-reviewer.md`, **FG** = fisko `generate-agents.mjs` (dev-agent template), **WO/WR/WG** = the counterparts in `claude-workflow` (the original variant), **SF** = savvy-flow skill (only for the tiering ideas already adopted). The fisko versions are the more mature ones and are the default source; `claude-workflow` adds the in-place mode.

## 1. Agents

### 1.1 Matrix (decision: no Fable models)

| Agent | `model` | `effort` | `isolation` | `tools` | `disallowedTools` | `skills` | `color` |
|---|---|---|---|---|---|---|---|
| `orchestrator` | `claude-opus-5-5` | `high` | – | `Agent(dev-workflow:implementer-s, dev-workflow:implementer-m, dev-workflow:implementer-l, dev-workflow:implementer-xl, dev-workflow:reviewer, dev-workflow:investigator, Explore), Read, Grep, Glob, Bash, AskUserQuestion, SendMessage, ToolSearch` | `Edit, Write` | `dev-workflow:orchestrator-playbook` | `purple` |
| `implementer-s` | `claude-sonnet-5-5` | `low` | `worktree` | `Read, Edit, Write, Grep, Glob, Bash` | `Agent` | `dev-workflow:implementer-playbook` | `green` |
| `implementer-m` | `claude-sonnet-5-5` | `medium` | `worktree` | same | `Agent` | same | `blue` |
| `implementer-l` | `claude-opus-5-5` | `medium` | `worktree` | same | `Agent` | same | `orange` |
| `implementer-xl` | `claude-opus-5-5` | `high` | `worktree` | same | `Agent` | same | `red` |
| `reviewer` | `claude-opus-5-5` | `high` | – | `Read, Grep, Glob, Bash` | `Edit, Write, Agent` | `dev-workflow:reviewer-playbook` | `yellow` |
| `investigator` | `claude-opus-5-5` | `xhigh` | – | `Read, Grep, Glob, Bash` | `Edit, Write, Agent` | `dev-workflow:investigator-playbook` | `cyan` |

Fields plugins ignore (`permissionMode`, `hooks`, `mcpServers`, `initialPrompt`) are never written. The `skills` name form follows spike S1 (if it fails, the generator inlines SKILL.md into the body).

**Fable is not used anywhere** (it needs usage credits). The generator and a CI test refuse any model ID containing `fable`. The hardest problems go to `investigator` (Opus 5.5, `xhigh`), then `implementer-xl`.

### 1.2 Generator — `plugins/dev-workflow/tools/generate-agents.mjs`

- Constants `MATRIX` (rows above) and `COMPLEXITY_GUARDRAILS`:
  - **s:** keep the diff minimal (1–2 files, no change to existing behaviour or contracts); if the task needs more, stop and report `misclassified` (FG/WG).
  - **m:** stay within one module; additive, backward-compatible changes only; contract/schema/multi-module change → `misclassified` (FG/WG).
  - **l:** read every affected module first, list changed contracts/schemas and all callers; update every caller or keep the old contract working; describe migration and deploy steps (FG/WG).
  - **xl:** investigate before changing code; state root cause or design options with evidence; smallest change that solves the problem, justified; call out security, concurrency, data-integrity and domain-critical implications (rules marked protected) explicitly (FG, "fiscal" generalized).
- Writes `agents/implementer-{s,m,l,xl}.md`; `orchestrator.md`, `reviewer.md`, `investigator.md` are hand-written but validated by the generator's `--check` (frontmatter equals `MATRIX`).
- `--check` exits 1 on drift (CI). `--out <dir>` and `--matrix <file>` serve `cw agents eject`.

### 1.3 Agent bodies (outline; ≤ 40 lines each)

**implementer-<tier>**
1. Identity: generalist implementer for complexity <TIER>; implements exactly the brief, nothing more.
2. "Your playbook (preloaded) is the procedure; run its steps in order. Your prompt names your brief file; read it first."
3. Complexity guardrails (generator constant).
4. Constraints: stay inside your worktree; never touch the protected checkout; never install or change dependencies (stop and report); exclusive checks are serialized by `cw checks`, don't work around it; after writing lines with escape sequences or invisible characters, read them back with `git diff` (FG lesson); never push.
5. Final message: exactly the output of `cw report save`.

**reviewer**
1. Identity: judges a change; never changes code, commits, pushes or switches branches; works in the worktree path from the brief (FR).
2. Playbook preloaded; brief file first.
3. Follow-up rounds: focus on changes since the last review; check every earlier blocking finding (FR/WR).
4. Final message: exactly the output of `cw review save`.

**investigator**
1. Identity: answers one question with evidence; read-only; separates traced from reasoned (FO step 3).
2. Playbook preloaded; brief file first.
3. Final message: exactly the output of `cw investigation save`.

**orchestrator**
1. Identity: turns a request into a testable spec, classifies, delegates, sees it through review to a PR; never writes or edits code or docs (backlog changes only through `cw ticket`).
2. Trigger: any user message that asks to work on a ticket — "starte mit Ticket NV-9", "arbeite an NV-9", "work on #42", "nimm das nächste Ticket", "next ticket" — starts the workflow at O1 at once: the first tool call is `cw intake <id>` (or `cw intake --next`). No confirmation question comes before the claim; the user's message is the instruction.
3. Playbook preloaded.
4. Never `cd`; absolute paths, `git -C`, subshells for path-sensitive commands (FO/WO).

## 2. Playbook skills

Common frontmatter: `user-invocable: false`, no `disable-model-invocation` (it would prevent preloading), `description` = "Fixed procedure for dev-workflow <role> agents. Not for direct use."

Budgets: `SKILL.md` ≤ 200 lines (the step list, contracts, the command for each step, escalation rules); each step file ≤ 80 lines; reference files ≤ 150 lines. `SKILL.md` links step files with relative links so they load on demand.

### 2.1 `orchestrator-playbook`

| File | Content | Sources |
|---|---|---|
| `SKILL.md` | Step list O1–O10 with the `cw` command per step; the never-`cd` rule; one dev agent per task at a time; "description and prompt verbatim from `cw`"; when to use `investigator` | FO intro, WO intro |
| `steps/01-intake.md` | **First tool call: `cw intake <id>` or `cw intake --next`** — it claims the ticket atomically for this session, so every other session, worktree and machine sees it as taken. Exit 3 → tell the user who holds it (host, phase, since) or why it is not available, and offer `cw ticket list --available`; a stale claim is taken over only after the user confirms (`cw ticket steal`). Then: check `knowledgeBase.features` and grep before treating anything as missing; pick only open tickets whose dependencies are done; scanner/pentest claims → investigator `claim-check`; preflight results from `cw intake` (auth missing → tell the user now and continue; dirty ticket file → stop and ask; never commit, stash or discard the owner's changes); docs-only tasks (release the claim with `cw ticket release` before handing them back) (`knowledgeBase.docsOnlyPaths`) are not delegated | FO 1, FO "Docs-only" |
| `steps/02-clarify.md` | AskUserQuestion until requirements and ACs are testable; ≤ `maxQuestionsPerRound`; ticket question in round 1 (existing IDs, "New row", "No ticket" → `noTicketKey`); never guess on `domain.neverGuess` topics: ask or point to the source that settles it | FO 2, WO 2 |
| `steps/03-spec.md` | `cw task new`; write the spec; rule references by ID, quoted verbatim; test-criteria wording (regression tests fail on unfixed code, other tests fail when the behaviour is removed); ask the implementer to trace dependency behaviour in the pinned version; technical claims backed by documentation or marked as observation; repo language; `cw spec lint` | FO 3, WO 3 |
| `steps/04-classify.md` | `cw classify`; complexity table (reference/complexity.md); never below `minComplexity` without user-approved override; one-sentence justification; split per `cw classify` recommendation; sub-task naming (suffixes, last one carries the plain branch name) | FO 4 + "sub-tasks", WO 4 |
| `steps/05-confirm.md` | For `workflow.confirm` complexities: show spec summary + classification, AskUserQuestion, `cw task confirm` | FO 5 |
| `steps/06-delegate.md` | `cw task start` → Agent call with exactly `subagent_type`, `description`, `prompt` from its output; then `cw task agent`; root cause unclear or xl design question → `cw task investigate` first, merge `briefAdditions` into the spec, re-lint | FO 6–7, SF tiering (Heavy→Careful split) |
| `steps/07-handle-report.md` | Status `done` → O8; `blocked` → answer from spec/plans/code via SendMessage to the same agent, else ask the user; `misclassified` → reclassify with the agent's reasons, tell the user old/new, confirm if new ≥ confirm threshold, new worktree (worktree mode) or reset rules (in-place mode, WO 7) | FO 8, WO 7 |
| `steps/08-review-loop.md` | `cw git foreign-commits` → back to the same implementer with the rebase command if any; `cw task review` → reviewer; `changes_requested` → `cw task return` → SendMessage to the same implementer, then the same reviewer via SendMessage; max rounds → escalate; spec change after approval restarts the cycle (round 1) | FO 9, WO 8–9 |
| `steps/09-deliver.md` | Host auth check; `cw base-moved` (rebase via the same implementer + review of `<tip>..HEAD`, not counted); unpushed commits on the base branch → list them and ask before pushing anything (the base branch itself is never pushed by the workflow); `cw pr body`; confirmation naming exactly what will be pushed (and what a merge deploys, from `deploy-impact`); push + PR via the host procedure; pack procedures for `deliver` (migration handover); `cw task cleanup` | FO 10 |
| `steps/10-close.md` | Report: classification, review rounds, PR link, cleanup result, what still needs the owner (migrations, manual tests, live tests); `cw task end` (the claim stays until the PR is merged and the row is gone; aborted tasks release it) | FO 11, WO 11 |
| `reference/complexity.md` | Generic s/m/l/xl table (WO table) + note that the profile adds escalations | WO "Complexity" |
| `reference/agent-messages.md` | Templates for SendMessage texts (blocked answer, review findings, rebase request); `cw` prints most of them | – |
| `reference/subtasks.md` | Split rules, builds-on chains, one PR from the last sub-task, "Builds on: origin/<branch>" for changes on an open PR | FO "Changes … on an open PR", FO sub-tasks |
| `reference/in-place-mode.md` | In-place mode: work directly in `appRoot`, one task at a time, reset rules, switch back at task end | WO 6–7, "Ending a task" |

### 2.2 `implementer-playbook`

| File | Content | Sources |
|---|---|---|
| `SKILL.md` | Steps 1–9 (spec 02 §4.6) with commands; escalation statuses; "never do by hand what a `cw` command does" | FG workflow |
| `steps/01-workspace.md` | `cw ws setup`; what to do if it exits 3 (`blocked` report) | FG 3, WG 3 |
| `steps/02-understand.md` | Read the brief, `cw context`, package docs, procedures whose trigger applies; ambiguous or contradicting AC → stop with `blocked`; never guess on `domain.neverGuess` topics | FG 1, 4 |
| `steps/03-tests-first.md` | One or more tests per AC; regression test for bug fixes; `cw step --done 3` | FG 5 |
| `steps/04-implement.md` | Follow applicable procedures and rules; stay in scope (CORE-SCOPE); `cw step --done 4` | – |
| `steps/05-prove.md` | `cw prove` for each new test (bug fix: the regression test's failing run goes into the report) | FG 5, CQ-12 |
| `steps/06-checks.md` | `cw checks --changed`; fix until green; never edit a check's configuration to make it pass | FG 6 |
| `steps/07-knowledge-base.md` | Profile `knowledgeBase` duties; `cw kb check`; `cw ticket done` when the ticket is fully done and `deleteRowWhenDone` | FG 7 |
| `steps/08-commit.md` | `cw commit msg` → `git commit -F`; `cw git lint`; review-fix commits on the same branch | FG 8 |
| `steps/09-report.md` | `cw report save` with status, ACs and evidence, migrations, docs, open points (tag `manual` for browser/live checks); final message = its output | FG "Final report" |
| `reference/escalation.md` | When to report `blocked` vs `misclassified`; what to leave behind (no commits for misclassified, state of the worktree) | FG, WG |

### 2.3 `reviewer-playbook`

| File | Content | Sources |
|---|---|---|
| `SKILL.md` | Steps R1–R9; severity rules; output contract | FR |
| `steps/01-scope.md` | `cw review scope`; foreign commits are blocking scope findings; non-goals | FR 1, 8 |
| `steps/02-checks.md` | `cw checks --changed` yourself; a failing check is always blocking | FR 2 |
| `steps/03-acceptance.md` | Each AC with named proof; `cw mutate` for each new or changed test; a surviving mutation is a blocking CORE-TEST-SPEC finding | FR 3 |
| `steps/04-rules.md` | `cw rules applicable --task` → check each; cite IDs; `rulesChecked` = that list | FR 4 |
| `steps/05-procedures.md` | Reviewer procedures that apply (migration review, project fiscal review, UI review) | FR 5–6 |
| `steps/06-correctness.md` | Logic errors, edge cases, broken callers, security beyond the rules | FR 7 |
| `steps/07-knowledge-base.md` | Profile duties (FEATURES, LESSONS, ticket row, docs drift); missing update is blocking where the profile says so | FR 9 |
| `steps/08-git.md` | `cw git lint --task` | FR 10 |
| `steps/09-verdict.md` | Build the JSON; mark cheap non-blocking findings `sendAlong`; `cw review save` | FR "Output", FO 9 |
| `reference/severity.md` | Blocking vs non-blocking; style preferences without a rule are never blocking | FR "Severity" |

### 2.4 `investigator-playbook`

| File | Content |
|---|---|
| `SKILL.md` | Steps: question → reproduce → trace → options → brief; output contract |
| `steps/01-question.md` | Restate the question and what would settle it |
| `steps/02-reproduce.md` | Reproduce with a command or test (scratch only; never change the repo) |
| `steps/03-trace.md` | Follow the code and dependencies (`cw deps where`); mark each finding `traced` or `reasoned` |
| `steps/04-options.md` | Options with trade-offs and effort; one recommendation |
| `steps/05-brief.md` | `briefAdditions` for the spec; `cw investigation save` |
| `reference/claim-check.md` | Scanner/pentest findings: check versions in the lockfile and the code path before accepting them (source FO 1) |

## 3. Starting an orchestrator session

Two equivalent ways; both make "starte mit Ticket XYZ" enough:

1. **Dedicated session:** `claude --agent dev-workflow:orchestrator` (alias suggestion printed by `cw init`, e.g. `alias orch='claude --agent dev-workflow:orchestrator'`), or permanently per developer and project with `"agent": "dev-workflow:orchestrator"` in their own `.claude/settings.local.json`. The orchestrator body (§1.3) treats every ticket request as the start of O1.
2. **Any session:** `/dev-workflow:ticket NV-9` loads the same playbook into the current session.

The `UserPromptSubmit` hook (spec 06 §6) recognises ticket requests in orchestrator sessions and adds the extracted ticket ID and the exact first command as context, so the start does not depend on the model's reading of the sentence.

## 4. Entry skills

### `skills/ticket/SKILL.md`

```markdown
---
name: ticket
description: Run a ticket or task through the dev workflow in this session — spec, classification, implementer in its own worktree, review and pull request.
argument-hint: "<ticket ID or task description>"
disable-model-invocation: true
---
For this task you are the dev-workflow orchestrator. Load the skill
`dev-workflow:orchestrator-playbook` with the Skill tool and follow it
exactly for:

$ARGUMENTS

While the workflow runs, its rules bind you: you don't write or edit code
or docs yourself, you delegate with the exact agent, description and prompt
`cw` prints, and you never `cd`. The workflow ends with the report of its
last step; after that this session is a regular session again.
```

(Source: fisko `.claude/skills/ticket/SKILL.md`.)

### `skills/setup/SKILL.md`

`disable-model-invocation: true`, `argument-hint: "[--refresh]"`. Steps: `cw doctor --fresh`; `cw init --detect --json`; walk the user through the open questions with AskUserQuestion (≤ 4 per round); write the proposed profile to `<scratchpad or $TMPDIR>/dw-profile.json`; tell the user to run, in their own terminal or with the `!` prefix, `cw init --write --profile <file>`; afterwards `cw doctor` and `cw playbook show implementer` to show the result. With `--refresh`: `cw rules build --check` and explain the drift.

## 5. Acceptance for Phase 3

- `node tools/generate-agents.mjs --check` passes; the CI test finds no `fable` and no ignored plugin-agent fields.
- `claude plugin validate --strict` passes.
- Every step file named above exists and stays within its budget (CI line-count test).
- Dry run (WP-48) in the fisko-like fixture: `/dev-workflow:ticket` from ticket to `cw pr body` with an `s` task, using the real agents.
