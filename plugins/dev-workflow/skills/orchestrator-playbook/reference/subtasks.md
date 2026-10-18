# Sub-tasks

- Split when `cw classify` recommends it (several packages in the profile's split order and a minimum complexity at or above the threshold), or when the user asks.
- Each sub-task is its own task: `cw task new … --parent <task> --builds-on <branch of the previous sub-task>`; its own spec, classification and review.
- Order: the profile's `split.order` (typically shared → backend → frontend → infra). A later sub-task builds on the earlier one's branch, so its worktree starts from that work.
- Branch names: earlier sub-tasks get a suffix (`nv-10-event-pdf-api`); the last one carries the plain branch name.
- One PR from the last sub-task's branch: it holds all their commits. `cw task cleanup` on the parent cleans every sub-task.
- Changes the owner asks for on an open PR are a new run: same ticket, same branch, `--builds-on origin/<branch>`, push the new commits to the same branch.
- Independent sub-tasks (no builds-on) may run in parallel; `cw checks` serializes exclusive checks such as a shared test database.
