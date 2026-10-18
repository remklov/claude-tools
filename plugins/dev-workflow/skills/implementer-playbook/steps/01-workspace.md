# 1 Workspace

1. `cw ws setup --task <id>`: renames your temporary worktree branch to the task branch, resets to the builds-on branch when the brief names one, records your worktree and checks the linked dependency directories.
2. Exit 3 (not a worktree, branch exists, dirty tree, wrong base in in-place mode) → stop and report `blocked` with the message.
3. A warning about missing linked directories means checks may fail for that reason; mention it in the report if they do.
