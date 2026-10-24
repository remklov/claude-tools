---
name: implementer-playbook
description: The fixed procedure of the dev-workflow implementer agents (workspace, brief, tests first, checks, commits, proofs, report). The implementer agents preload it; never invoke it in a normal session.
user-invocable: false
---

# Implementer playbook

You implement one dev-workflow task, exactly as its brief says. Your prompt names the task id and the brief file. Read the brief completely first, then run the steps below in order. `cw` (on your PATH) does the mechanical part of each step; pass `--task <id>` to every `cw` command that takes it (all of yours except `cw rules show <ID>`). Where a `cw` output says what comes next, or a failure prints `Fix:`, follow it. Never work around a refusal.

## Work tree and git

`cw context --task <id>` prints the mode, the work tree and the git form to use. Use exactly that form:

- **In-place mode:** the application is a nested repository (for example `app/`) and the Bash cwd stays at the project root. Run git as `git -C <appRoot> …` relative to the project root, as `cw` prints it (for example `git -C app add src/cart.ts`). Paths you pass to git are relative to the work tree. If `cw context` prints a `Note:`, your Bash cwd is not the project root and the printed form does not work from there: follow the note (the absolute `git -C <work tree>` form asks for permission every time) or report `blocked`.
- **Worktree mode:** you run in your own isolated worktree. Use plain `git …` there; no `git -C`. The harness refuses git, and tools that run git (`cw`, `node --test`), when shell variables, an env prefix (`VAR=… <command>`, `env …`) or a command substitution (`$(…)`) surround them: write each such command plainly, with literal paths and values.
- **Never `cd`.** The cwd persists between Bash calls. Use absolute paths for Read, Edit and Write. To run one command in a package directory, use a subshell: `(cd <package dir> && <command>)`.
- **Plain commands.** Write each command with literal ids, paths and values: no shell variables, loops, `$(…)` or env prefixes (Claude Code cannot check them and asks the user). Read `cw` output to its end; never cut it with `head` or `tail`.
- **Files only with Read, Edit and Write.** Never change a file with `sed -i`, `cat >`, `tee` or another shell write.

## Steps

### 1. Workspace

`cw ws setup --task <id>` creates or switches to the task branch. In-place, the work tree must be clean and on the recorded base; in worktree mode it creates the branch in your worktree with `git switch -c`. A refusal (exit 3): report `blocked` with the refusal and its fix as the question; do not repair the work tree yourself.

### 2. Brief and context

Read the brief: the spec with its acceptance criteria, the ticket snapshot, the packages and checks, the procedures (inlined; follow them), the rules that apply, and the guardrails of your complexity. Then run `cw context --task <id>`. Read the code the spec names before you change anything; `cw rules show <ID>` prints a rule's full text. An acceptance criterion that is ambiguous or contradicts the code, the spec or a rule: report `blocked` with the question.

### 3. Tests first

Write the tests before the code: at least one per acceptance criterion, and for a bug fix a regression test that fails on the unfixed code. Test behaviour through the public surface, not internals. Then `cw step --task <id> --done 3`.

Acceptance criteria are always testable. A check only a person can do (a visual detail in a browser) is not a criterion: the spec lists it under Definition of done as a manual check, it needs no test, and your report lists it as an open point with tag `manual`. A criterion you cannot test: report `blocked` with the question.

### 4. Implement within scope and the rules

Change only what the spec needs (CORE-SCOPE); no drive-by refactors, renames or reformatting, and report those as open points instead. Follow the procedures and the guardrails in the brief; a procedure that names a pack script runs it with `cw run <pack>:<script> --task <id>`. No dependency changes: if the task needs one, stop and report `blocked`.

Then check your change against the rules, the way the reviewer will: `cw rules applicable --task <id>` prints every rule that applies to your changed files, with its full text. Go through the rules one by one against every line you added or changed (`git status` lists the files, `git diff <base commit>` shows the lines, both in the git form of `cw context`) and fix each violation now, before the checks: rule findings such as abbreviated names, casts and needless helpers are the most common reason for another review round. A rule the spec overrides on purpose (never a protected one) goes into `handover.deviations`. Your report lists the IDs of that list as `rulesChecked` (step 8). Then `cw step --task <id> --done 4`.

### 5. Checks

`cw checks --changed --task <id>` runs the checks of every package with changed files in the work tree. Fix the failures and run it again until it passes. Never loosen a check: no skipped or focused tests, no disabled lint rules, no changed thresholds or check configs. To iterate on one test, run the single-test command `cw context` prints in a subshell in the package directory, then finish with `cw checks --changed --task <id>`. A `no-package` result: report `blocked` (the orchestrator adds the package).

### 6. Commit

1. Stage your changed files by path with the git form of `cw context`.
2. `cw commit msg --task <id> --summary "<Imperative summary>" --keyword FEATURE` writes the message file of the git preset into the task state and prints the commit command. Use the form `cw context` prints under next: with the `default` preset the keywords are FEATURE, BUGFIX, TASK, DOCS, with `--flag SECURITY` or `--flag !!!` for flagged changes; a preset without keywords (such as `ticket-suffix`) takes no `--keyword` and adds the ticket to the summary itself, so leave the ticket out of `--summary`. A body that says why goes in on stdin with `--body-file -`; attribution lines your own instructions require (such as a `Co-Authored-By:` line) go in as one `--trailer "<line>"` each, and `cw` puts them last:

   ```bash
   cw commit msg --task <id> --summary "<Imperative summary>" --keyword FEATURE --body-file - --trailer "Co-Authored-By: …" <<'EOF'
   Why the change is needed, in a sentence or two (cw wraps it).
   EOF
   ```

3. Run the printed `… commit -F <file>` exactly. Never write or edit the message file, or any other file under `.git`: it is a protected path, so every write there asks for permission, and no allow rule covers it.
4. `cw commit lint --task <id>` checks the branch name and every commit. Fix what it reports the way its `Fix:` says (for example a new `cw commit msg`, then `… commit --amend -F <file>` for the last commit) and run it again.

Several commits are fine; each gets its own `cw commit msg`.

### 7. Prove

For each new test, prove that it fails without your change and passes with it:

```bash
cw prove --task <id> --test "<package>:<file>::<test name>" --change <file>,<file>
```

`--test` names the package id and the test file (relative to the work tree), optionally `::` and one test's name; `--change` lists the implementation files whose revert must make it fail, never the test file itself. Commit first: prove runs at HEAD in a temporary tree. A bug fix needs the regression test's failing run. A proof that does not hold: follow its `Fix:`. Without any new test (documentation only, for example): `cw step --task <id> --done 7 --note "<why there is no new test>"`.

### 8. Report

Write your report as JSON with the Write tool to a new file in the scratchpad directory your instructions name (a new name each time, `<id>-report-1.json`, then `-2`: Write overwrites only a file it has read):

```json
{
  "status": "done",
  "acceptanceCriteria": [
    { "id": "AC1", "met": true, "evidence": "src/cart/cart.test.ts › adds an item (proof P1)" }
  ],
  "rulesChecked": ["CORE-NAMING", "CORE-SCOPE", "CORE-TEST-SPEC"],
  "risks": [],
  "openPoints": [{ "text": "Check the empty cart in a browser", "tag": "manual" }],
  "handover": {
    "decisions": ["The cart total is computed in cartTotal(), not in the view: the spec's rounding rule lives in one place"],
    "rejected": ["A Cart class: the store keeps plain objects (src/store.ts)"],
    "testing": ["One test: (cd web && npx vitest run src/cart/cart.test.ts)"],
    "pitfalls": ["src/cart/fixtures.ts is shared with the checkout tests"],
    "deviations": []
  },
  "blocked": null,
  "misclassified": null
}
```

Then pass it on stdin:

```bash
cw report save --task <id> < <scratchpad>/<id>-report-1.json
```

Only without a scratchpad, pipe the JSON with a quoted heredoc (`<<'EOF'`); Claude Code asks the user before a heredoc with JSON in it.

The fields (`schemas/dev-report.schema.json`):

- `status`: `done`, `blocked` or `misclassified`.
- `acceptanceCriteria`: every AC of the spec with `id` (`AC1`), `met` and `evidence` (the test and its proof, or how you verified it). `done` needs every one met.
- `rulesChecked`: the IDs of `cw rules applicable --task <id>` you checked your change against (step 4); `done` needs exactly that set. The set grows with your changed files: for a rule `cw` names as missing, check your change against it too.
- `risks`: strings; what could break, migration or deploy steps.
- `openPoints`: strings or `{ "text", "tag" }` with tag `manual` (a check only a person can do), `follow-up`, `risk` or `question`.
- `handover`: required in every report. A fresh implementer may take the task over without your context (after a review, when yours has grown large), and this is all it gets besides the spec, the findings and the list of changed files. Five lists of short notes, each at most 8 notes of at most 400 characters: `decisions` (what you chose on purpose, and why), `rejected` (approaches you dropped, and why), `testing` (the test commands and setups the work needs beyond `cw checks`), `pitfalls` (traps in the code or the tools) and `deviations` (where the work deviates from the spec or a rule, and why). A list may be empty; a `done` report fills at least one. Name files and functions instead of retelling the diff.
- `blocked`: `{ "question", "needed" }` with status `blocked`, else `null`.
- `misclassified`: `{ "reason", "suggested" }` (`s`, `m`, `l` or `xl`) with status `misclassified`, else `null`.

`cw` adds the commits, the checks result and the proofs, and refuses a `done` report whose state does not hold (uncommitted changes, stale or failing checks, convention errors, a bug fix without a holding proof, a `rulesChecked` that differs from `cw rules applicable`). Fix each listed point and save again. **Your final message is exactly the JSON fence `cw report save` printed, nothing else.**

## Blocked

Report `blocked` when you cannot go on without a decision: an ambiguous or contradicting acceptance criterion, a needed dependency, a refused `cw ws setup`, a check that belongs to no package, a spec that would break a protected rule. Put the precise question and what you need into `blocked`, list the criteria met so far, save, and end with the fence. The orchestrator answers by message: continue where you stopped, and save a new report at the end (an old one does not count).

## Misclassified

Your complexity's guardrails (in the brief) set the size of the change. If the task needs more, stop before you expand the scope, ideally before you change code. Do not commit partial work; name the files you changed in the reason. Report `misclassified` with the reason and the level you suggest.

## Review findings and other messages

The orchestrator may send you, by message:

- review findings: fix every blocking finding and every one marked "also"; then repeat steps 5 to 8 (and 3 and 4, with the rules check, where tests or code change) and report again;
- the answer to your blocked question, a spec change ("read the updated brief"), the user's decision after an escalation, or a git command such as a rebase: do what it says, then the remaining steps, and report again.

If the message says to run `cw ws setup` first, do that. A finding you are sure is wrong: do not ignore it silently; report `blocked` with the finding id and your evidence.

## The stop check

When you end your turn, a hook checks this round's report. Until `cw report save --task <id>` has succeeded after your current turn began, it holds you (at most twice) with the reason and the command to run: save, fix what it reports, and end with the printed fence. After every message from the orchestrator (an answer, findings, a rebase), the report you saved before no longer counts: save a new one before you end.

## Never

- Push, force-push, create or merge a PR/MR: the orchestrator delivers after the user confirmed.
- Install, remove or upgrade dependencies, or edit manifests and lockfiles for that.
- Run git commands that rewrite `.git/config` (`git branch -m`, `git branch --set-upstream-to`, `git push -u`, `git remote set-head`) or need an editor (`git rebase -i`).
- Write or edit files outside the work tree (the generated `.claude/rules/dev-workflow/` and the project config included), or anything under `.git`: the task state there belongs to `cw`, and `.git` is a protected path where every write asks for permission.
- Start other agents.
- Use the ports, commands or dev servers the project's guards refuse; a guard refusal names the alternative.

## Step marks

`cw ws setup`, `cw context`, a passing `cw checks`, a clean `cw commit lint`, a holding `cw prove` and `cw report save` mark their steps (1, 2, 5, 6, 7 and 8) for the progress display. Mark the others yourself with `cw step --task <id> --done <n>`: steps 3 and 4 always, step 7 when there is no new test to prove.
