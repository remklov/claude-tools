# 0022 `cw task start` checks the overlap with the other open tasks

- Status: accepted, 2026-11-04 (owner decision)

## Context

Several tasks of one project can be open at once:

- tasks started in parallel in worktree mode;
- a task that has ended while its PR waits for the merge, when the next task starts on a base without its changes.

Nothing compared them. Two tasks that changed the same lines conflicted only at the second PR, outside the workflow; fisko needed a merge commit for BILL-28. Two tasks that both add a migration (`018_….sql` twice) or change `package-lock.json` may merge without a textual conflict and still break the base.

Before the spec only the ticket is known. Once a task is classified, its spec names the paths it changes (`task.paths`). `cw task start` is the last point before an implementer writes code, and since ADR 0021 it has just fetched origin's base.

## Decision

- **`cw task start` compares the task with every open task** (`cli/lib/overlap.mjs`). Open tasks are:
  - **active tasks that have started** (round ≥ 1). A task still in its spec meets the overlap at its own start.
  - **tasks that ended `done` within 30 days whose branch has commits origin's base lacks**, both as commits and as patches (`git cherry`).
- **What counts for the other task:** its spec's paths, the files its branch changed since its base, and for an active task the uncommitted files of its work tree.
- **Three kinds of overlap:**
  - **The same file.** A directory in a spec matches the files below it.
  - **One exclusive area:** a glob of the new `workflow.exclusivePaths`, such as `fisko-api/migrations/**` or `**/package-lock.json`, that both tasks touch with different files.
  - **The same package.**
- **What happens:**
  - A shared file or exclusive area is a refusal (exit 3) that names the tasks and files. The orchestrator asks the user. To start anyway: `cw task start --task <id> --accept-overlap "<the user's reason>"`, which the history records. To wait: the task keeps its phase until the other PR is merged.
  - A shared package alone is only a line in the output.

## Consequences

- **The decision before the code.** The user decides before the implementer writes code, not at the second PR.
- **Squash merges.** After a squash merge, the ended task's commits stay unknown to the base. Such a task counts as open for up to 30 days after it ended, and the user accepts the overlap. Rebase and merge commits are recognised.
- **Only the spec's paths.** A task whose spec names too few paths can overlap without a warning. The review's scope check stays the net.
- **No network.** The check doesn't call the host; it relies on the fetch of ADR 0021.

## Evidence

- **Code:** `taskChangedFiles` (`cli/lib/cycle.mjs`), `task.paths` from `cw classify` (`cli/commands/classify.mjs`), `listTasks` (`cli/lib/task.mjs`), dev-workflow 0.9.0.
- **fisko:** the merge commit `f5efe45` of BILL-28; the migrations under `fisko-api/migrations/` are numbered `014_` to `017_`.
- **Tests:** `tests/integration/overlap.test.mjs` covers:
  - a planned file and a changed file;
  - the refusal and `--accept-overlap` with its history note;
  - an exclusive area with different files;
  - a shared package as a note only;
  - an ended task that counts until its branch is pushed to origin's base.
