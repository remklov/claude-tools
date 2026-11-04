# 0021 The base branch is brought up to date with origin before the spec and before the start

- Status: accepted, 2026-11-04 (owner decision)

## Context

`cw` never fetched. `cw task start` recorded the tip of the **local** base branch as the task's base (`resolveBase`, `cli/lib/cycle.mjs`), and `cw ws setup` created the task branch there:

- In worktree mode, Claude Code also creates the implementer's worktree from the main checkout's HEAD when `worktree.baseRef` is `head`, as in fisko.
- The orchestrator reads the code for the spec in the same checkout (O1).
- A stale local base therefore gave a spec against old code and a task branch on an old base. Merge conflicts with work merged in the meantime then showed up only at the PR, outside the workflow. BILL-28 needed `f5efe45 Merge main into the billing lock branch`.

Tasks that run in parallel make this likelier: each merge moves origin's base, while the local one stays.

## Decision

- **Two points update the base.**
  - `cw ticket context` in O1 runs first, before it reads the ticket file and the existing work on the key, so the ticket, the remote branches and the code the spec reads are origin's.
  - `cw task start` updates again right before it records the base, so merges during the spec phase reach the task branch.
- **One way to update** (`cli/lib/upstream.mjs`):
  - `git fetch origin` with every branch, because `ticket context` also looks for the key on the remote-tracking branches.
  - Then **only a fast-forward** of the base branch (`git.defaultBase`, or `--base` at the start):
    - with `git merge --ff-only` where it is checked out in the work repo (the main checkout, or `app/` in in-place mode);
    - with `git update-ref` from the commit read before where it is checked out nowhere, so no file changes.
- **Never forced.** The base stays as it is, and the result names why:
  - local commits that origin lacks (`ahead`), or a branch that has `diverged`;
  - a checkout in another worktree (`elsewhere`);
  - local changes in the files the update touches (`blocked`, git's own refusal);
  - a failed fetch, a missing `origin/<base>` or a missing local base.
- **The user decides.**
  - In O1 such a result is a warning, and the orchestrator asks the user: go on with the local base, or stop and update it first.
  - At `cw task start` it is a warning, and the task starts from the local base. The user decided that in O1; the orchestrator tells them in one line.
- **`git.updateBase`** (default `true`) turns it off. A work repo without `origin` stays as it is, and the output says so in one line.

## Consequences

- **Fetch over the network.** `cw ticket context` and `cw task start` now fetch.
  - `GIT_TERMINAL_PROMPT=0` keeps a fetch that needs a password from waiting, and a 60-second limit ends a hanging one.
  - Whether the fetch passes in a session with Claude Code's sandbox (network rules, SSH) is not yet observed. A failure is only a warning.
- **The user's checkout moves.**
  - In worktree mode the main checkout on the base branch moves with it. Local changes in other files stay, and git refuses the update when they touch the same files.
  - Other sessions that read that checkout during their spec phase see the newer code. Running implementers work in their own worktrees and are not touched.
- **`existingWork` sees current remote branches**, also those of teammates who pushed since the last fetch.
- **Still no conflict check between parallel tasks.** Two tasks that change the same lines conflict at the second PR. Only the base is fresh at the start.

## Evidence

- **Code:** `resolveBase` (`cli/lib/cycle.mjs`), `setupWorktree` and `setupInPlace` (`cli/lib/ws.mjs`), and the comments "cw does not fetch" in `cli/commands/spec.mjs` and `cli/commands/delivery.mjs`, all at dev-workflow 0.8.2.
- **fisko, observed 2026-11-04:** `worktree.baseRef: "head"` in `.claude/settings.json`, and the merge commit `f5efe45` of BILL-28.
- **Tests:** `tests/integration/base-update.test.mjs` covers:
  - the fast-forward with the files and the remote branches;
  - `current`, `blocked` (local change kept), `diverged` and `ahead`;
  - a base checked out nowhere (ref moves, work tree unchanged) and one checked out elsewhere;
  - a failed fetch, no remote, and `git.updateBase: false`;
  - `cw task start` recording the updated base, and starting from the local base after a failed fetch.
