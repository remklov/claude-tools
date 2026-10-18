# ADR 004: Task state in the git common dir, claims as remote refs

Status: accepted (2026-10-18), verified by spikes S10 and S12

Task state, briefs and reports live in `<git-common-dir>/dev-workflow/`, shared by all worktrees and never committed. Who works on which ticket lives in `refs/claims/<ID>` on the remote, created atomically with `git push --force-with-lease=<ref>:`; the backlog file never records "in progress".

Why: a marker committed to the backlog is invisible to other machines and worktrees until pushed and pulled, is not atomic, and causes merge conflicts.
