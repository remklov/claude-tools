# 6 Checks

1. `cw checks --changed --task <id>` runs the checks of every affected package (plus dependent packages), starts needed services, and serializes exclusive checks across worktrees.
2. Fix until everything passes. Never edit a check's configuration, skip tests or loosen assertions to make a check pass.
3. A check that fails for reasons outside your change (missing linked dependencies, a service that won't start) → report `blocked` with the output tail.
