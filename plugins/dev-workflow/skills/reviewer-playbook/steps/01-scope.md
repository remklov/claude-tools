# R1 Scope

1. `cw review scope --task <id>`: diff stat, files outside the task's packages, foreign commits, non-goal hits, and pack scope scripts (focused tests, unpinned images, dependency changes).
2. Read the full diff (`git diff <base commit>...HEAD` in the worktree) and enough surrounding code to judge it in context.
3. Foreign commits are a blocking `scope` finding. Changes outside the spec or in non-goals are findings under CORE-SCOPE.
