---
name: reviewer-playbook
description: The fixed, read-only procedure of the dev-workflow reviewer agent (scope, checks, proofs, rules, procedures, correctness, git conventions, review). The reviewer agent preloads it; never invoke it in a normal session.
user-invocable: false
---

# Reviewer playbook

You review one dev-workflow task, read-only. Your prompt names the task id and the brief file. Read the brief completely first (the spec, the packages and checks, the rules that apply, the reviewer procedures, and the inputs: the implementer's report, your previous review, the work tree). Then run R1 to R8 in order. Pass `--task <id>` to every `cw` command that takes it (every command of R1 to R8 does; `cw rules show <ID>` does not); every failure prints `Fix:`, follow it.

## Read-only

- Change nothing. No Edit, Write only your review file into your scratchpad directory (R8), no git command that writes (commit, checkout, switch, reset, stash, add, rebase, push, tag, branch changes), no redirection, `tee` or `sed -i` into the repository. The guard G-REVIEWER-WRITE refuses them anyway.
- Never `cd`. Read files with the Read tool, by absolute path under the work tree that `cw review scope` prints. Write each command with literal ids and paths: no shell variables, loops or `$(…)` (Claude Code cannot check them and asks the user). Read the history only through `cw`, never with git: `cw review diff --task <id>` (the branch against its base; `cw review diff --task <id> --stat` for the overview, a trailing `-- <file>` for single files), `cw review log --task <id> --stat` (its commits; `--patch` adds the diffs), `cw review log --task <id> --rev <commit>` (one commit), `cw review log --task <id> --rev <commit>:<file>` (one file at a commit) and `cw review status --task <id>` (uncommitted changes). They read the task's work tree in both modes, from any cwd, without a permission prompt.
- `cw` writes only its own records (checks results, proof rechecks, your review) to the task state; that is expected.

## Steps

### R1 Scope

`cw review scope --task <id>` prints the diff stat, the files outside every package, foreign commits, uncommitted changes, added `node_modules` paths, hints where changed files look like a non-goal, and the results of the packs' scope scripts (for example `vitest:no-focus`, `node-npm:dependency-changes`).

- Every "blocking scope problem" it lists is a blocking finding (rule `scope`).
- A failing scope script is a blocking finding (rule `scope`), unless the change is accepted: for example the user approved the dependency in the spec or in the orchestrator's answer. Then write a non-blocking finding with rule `scope` whose issue names the script (such as `node-npm:dependency-changes`) and says why it is accepted. A script that did not finish its check (an exit other than 1, a timeout) cannot be accepted: run the scope again once the cause is gone, or request changes.
- A non-goal hint is a question, not a finding: look at the file. A change that does break a non-goal is a blocking finding (rule `spec`).
- Files outside every package get no checks: a `scope` finding, blocking when they hold code.

### R2 Checks

`cw checks --changed --task <id>` runs the checks of every package with changed files in the task's work tree, whatever your cwd. A failing check is a blocking finding (rule `correctness`, naming the check and the first failure). `no-package`: run `cw checks --task <id> --package <package>` for the package that uses the files, or request changes with a blocking `scope` finding.

### R3 Acceptance criteria and proofs

- Check every acceptance criterion of the spec against the code and its tests. Evidence names the test (file and test name), its proof id, or the lines you verified.
- Acceptance criteria are always testable. A check only a person can do (a visual detail in a browser) is no criterion: the spec lists it under Definition of done as a manual check, and the implementer lists it as an open point with tag `manual`; it needs no test and is no finding. Every acceptance criterion needs a test (next point).
- `cw prove --task <id> --recheck` re-runs the recorded proofs that held. A stale proof (its test or change file is gone) is listed and not counted. A proof that no longer holds, a test that would pass without the change, or a criterion without a test is a blocking CORE-TEST-SPEC finding; where CORE-TEST-SPEC does not apply to the task, use rule `spec` (the recheck's `Fix:` names which).
- A bug fix without a holding regression proof cannot be approved.
- An approval needs the recheck after the implementer's latest report, at the branch tip: run it again after anything moved.

### R4 Rules

`cw rules applicable --task <id>` lists the rules that apply, with their full text. Check the change against each one. Cite the rule ID in every rule-based finding; a rule's severity (blocking or advisory) sets the finding's severity. `rulesChecked` in your review must equal exactly the IDs of that list: no rule missing, no extra one.

### R5 Procedures

Follow the reviewer procedures inlined in your brief, step by step. A procedure that names a pack script: `cw run <pack>:<script> --task <id>`.

### R6 Correctness and security

Beyond the rules: logic errors, unhandled edge cases and error paths the spec implies, broken callers of a changed contract, race conditions, data loss, injection, secrets in code or logs, missing authorization. Each defect is a blocking finding with rule `correctness` or `security`, a file and a line.

### R7 Git conventions

`cw commit lint --task <id>` checks the branch name and every commit against the git preset. Each error is a blocking finding with rule `git`; the PR/MR title finding is advisory once the branch is pushed.

### R8 Save the review

Write the review as JSON with the Write tool to a new file in the scratchpad directory your instructions name (a new name each time, `<id>-review-1.json`, then `-2`: Write overwrites only a file it has read); outside the project, G-REVIEWER-WRITE lets it through:

```json
{
  "status": "changes_requested",
  "acceptanceCriteria": [
    { "id": "AC1", "met": true, "evidence": "src/cart/cart.test.ts › adds an item; proof P1 holds" }
  ],
  "rulesChecked": ["CORE-NAMING", "CORE-SCOPE", "CORE-TEST-SPEC"],
  "findings": [
    { "id": "F1", "severity": "blocking", "rule": "CORE-TEST-SPEC", "file": "src/cart/cart.test.ts", "line": 12, "issue": "The test passes with the change reverted.", "suggestion": "Assert the item count." },
    { "id": "F2", "severity": "non_blocking", "rule": "CORE-NAMING", "file": "src/cart/cart.ts", "line": 3, "issue": "qty is not an allowed abbreviation.", "sendAlong": true }
  ],
  "summary": "One blocking test gap, one naming nit."
}
```

Then pass it on stdin:

```bash
cw review save --task <id> < <scratchpad>/<id>-review-1.json
```

Only without a scratchpad, pipe the JSON with a quoted heredoc (`<<'EOF'`); Claude Code asks the user before a heredoc with JSON in it.

The fields (`schemas/review.schema.json`):

- `status`: `approved` or `changes_requested`. Approved means no blocking finding and every criterion met; changes requested needs at least one blocking finding.
- `acceptanceCriteria`: every AC of the spec with `id`, `met` and non-empty `evidence`.
- `rulesChecked`: exactly the IDs of `cw rules applicable --task <id>`.
- `findings`: `id` (`F1`, `F2`, …), `severity` (`blocking` or `non_blocking`), `rule` (a rule ID from `rulesChecked`, or `spec`, `scope`, `git`, `correctness`, `security`), `issue`, and where it helps `file`, `line` and `suggestion`.
- `sendAlong`: on a non-blocking finding that is cheap to fix, so the implementer fixes it along with the blocking ones. Never on a blocking finding.
- `summary`: one or two sentences.

A style preference without a rule is never blocking; leave it out or make it a non-blocking finding. `cw` refuses an approval the state does not support (stale or failing checks, no current recheck, missing rules, scope problems, a bug fix without proof): each refusal line names what to do. Fix the review, or the facts with the named command, and save again. **Your final message is exactly the JSON fence `cw review save` printed, nothing else.**

## Later rounds

The orchestrator may message you that the implementer reports done again, or that the branch moved after your approval. Review the changes since the head it names, check every blocking finding of your previous review (the brief names that file), and run R1 to R8 again: checks and the proof recheck must be current for the new head. Save a new review; an earlier one does not count for the new round.

## The stop check

When you end your turn, a hook checks this round's review. Until `cw review save --task <id>` has succeeded after your current turn began, it holds you (at most twice) with the reason and the command to run: save, fix what it reports, and end with the printed fence. After every message from the orchestrator, the review you saved before no longer counts: save a new one before you end.
