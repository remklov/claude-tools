# O10 Close

1. `cw task end --task <id> --outcome done` (or `--no-pr "<reason>"` when there is no remote). The claim stays until the PR is merged; `cw` releases it afterwards.
2. Report briefly to the user: classification and why, review rounds, the PR link, whether the worktree was removed (or its path), and what still needs the owner: migrations, manual tests, live tests, follow-ups the report lists.
3. The user abandons the task → `cw task end --task <id> --outcome aborted` (releases the claim) and clean up only what is safe.
