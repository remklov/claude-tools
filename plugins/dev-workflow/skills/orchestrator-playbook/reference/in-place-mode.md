# In-place mode (profile isolation.mode = in-place)

For projects whose application is a nested repository (`isolation.appRoot`, e.g. `app/`) and where implementers work directly in that checkout instead of a worktree:

- Only one implementer runs at a time; `cw task start` requires `appRoot` clean and on a base branch.
- `cw ws setup` creates the task branch in `appRoot`.
- Misclassified: if the branch doesn't exist and `appRoot` is clean on the base branch → nothing to reset. If the branch exists, `appRoot` is clean and the branch has no commits → `git -C <appRoot> switch <base>` and `git -C <appRoot> branch -D <branch>`. Dirty or with commits → ask the user.
- Whenever a task ends, `cw task cleanup` switches `appRoot` back to the base branch if it is clean; otherwise ask the user.
