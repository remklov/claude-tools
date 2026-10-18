# Spec 07 — Plugin `agents-progress` (mod)

Source: the existing progress mod in `claude-workflow/plugins/` (register.tsx 342 lines, avatars.ts 190, types 44, tests 3 files). The savvy plugins are removed from all machines and projects (decision); features fisko used from `savvy-progress` (planned tasks, per-agent step progress) are rebuilt here from the workflow state, not copied. The MIT notice for the crab artwork and event handling adapted from savvy-progress stays in `avatars.ts` and the README.

Minimum Claude Code: 2.1.300 (terminal and Desktop). Tested: 2.1.302.

## 1. Changes at a glance

| # | Change | Files |
|---|---|---|
| 1 | Rename plugin, pane id, command and state keys to `agents-progress` and remove every reference to the former project context **before the first commit** (the forbidden-terms check of spec 08 §2 must pass; git history is not imported) | all |
| 2 | Task band and pane read the workflow state file instead of the `progress` tool (spike S6); the tool is removed. Plan B (S6 fails): keep the tool with the new phase list and have the orchestrator playbook call it with the JSON `cw task …` prints | `hooks/register.tsx`, new `hooks/state.ts` |
| 3 | Avatars by role and area instead of agent-name type; new costume `scientist` for the investigator | `hooks/avatars.ts` |
| 4 | Generic phases: `spec`, `classify`, `confirm`, `implement`, `review`, `deliver`, `done`, `escalated`, `aborted` | `types/index.d.ts`, band |
| 5 | Step progress per implementer (`steps.done/total · note`) and planned sub-tasks | pane |
| 6 | Tests rewritten for the state-driven model | `tests/*.test.ts` |
| 7 | Band shows tickets claimed by other sessions or machines (from the claim registry) | `hooks/claims.ts`, band |

## 2. State source (`hooks/state.ts`)

- On `session.start`: resolve the common dir once with `$.process.run('git', ['rev-parse', '--git-common-dir'], { cwd: await $.session.cwd() })`; no repo → state stays empty and only the generic agents pane works.
- Every second (existing `$.clock.every(1000)` tick): `$.fs.stat(<common>/dev-workflow/state.json)`; when `mtimeMs` changed, `$.fs.read` + `JSON.parse` + shape check (ignore invalid content, keep the last good state); update the `tasks` atom; `$.ui.invalidate('ui.render')` only on change.
- Additionally re-read right after a Bash `tool.call` whose `command` starts with `cw ` (no waiting for the tick).

## 3. Agents pane

Rows as today (avatar, description, meta line, status bar, `ctx % · tokens · time`), plus:

- **Role and tier:** parsed from `subagentType` `(<plugin>:)?<role>(-<tier>)?` → meta shows `implementer · M` instead of the raw type.
- **Task link:** a run belongs to a task when `state.tasks[].agents.<role> === run.agentId`, or (during the first run, before `cw task agent` recorded the id) when `run.description === state.tasks[].descriptions.<role>` (`cw` prints the description the orchestrator must use, so this match is exact).
- **Steps:** linked implementer rows show `step 5/9 · checks` from `task.steps`; review rows show `Round n/3`.
- **Planned:** tasks in phase `spec`/`classify`/`confirm` and sub-tasks not yet started appear in a "Planned" section with their title and complexity badge (replaces savvy-progress's planned list).
- Auto-open once per session when the first `dev-workflow:` agent starts (as today for `*-dev-*`).
- Command `/agents-progress` toggles the pane.

## 4. Task band (AbovePrompt)

One line per task whose phase is not `done`/`aborted`: `● NV-9 · Fix the CRE totalIva · review · Round 2/3 · L` plus a `PR` link when `prUrl` is set; `escalated` in the failure colour. Hidden while there is no active task or a survey shows. Other mods' band content stays below (as today).

Below the own tasks, one dim line lists claims held elsewhere: `elsewhere: NV-2 · implement · laptop · 2h  ·  OPS-14 · review · cloud · 20m` (stale ones marked). Source: `$.process.run('cw', ['ticket', 'claims', '--json'])` at session start and then at most every 120 s while the session is idle (`e.props.isWorking` false); failures keep the last result silently. The line is hidden when there are no foreign claims.

## 5. Avatars (`AVATARS` constant)

| Role / area | Costume |
|---|---|
| implementer, area `frontend` | painter |
| implementer, area `backend` or `data` | chef |
| implementer, area `infra` or `tooling` | engineer |
| implementer, several or no areas | plain (with tier badge) |
| reviewer | detective |
| investigator | scientist (new: lab coat and goggles in the costume layer; accent from the palette) |
| `Explore` | pirate |
| anything else | plain |

Tier accent colours and badges stay (`s` `#1D9E75`, `m` `#378ADD`, `l` `#BA7517`, `xl` `#D85A30`). Running crabs walk unless reduced motion; the terminal shows the badge only (unchanged).

## 6. Tests (`claude plugin test`)

- `avatars.test.ts`: role/tier parsing for plugin-scoped and bare names; costume by area; unknown roles.
- `state.test.ts`: valid state, invalid JSON (keeps last good), missing file, mtime unchanged (no re-read).
- `pane.test.ts`: ordering (running first), task linking by id and by description, steps line, planned section, round label.
- `band.test.ts`: one line per active task, escalated colour, PR link only for https, hidden without tasks.
- Existing agent lifecycle tests (spawn, SendMessage resume, turn.step usage, turn.complete) carried over.

## 7. Manual acceptance (WP-63)

Terminal (wide fullscreen and narrow) and Desktop app Code tab: run the fixture dry run (WP-48) and check pane, avatars, steps, band and PR link; reduced motion on macOS; no duplicate panes (savvy removed).
