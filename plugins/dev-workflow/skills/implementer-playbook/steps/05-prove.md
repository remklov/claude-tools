# 5 Prove

For each new or changed test that covers your change:

1. `cw prove --task <id> --test <package>:<test file>[::<test name>] --change <changed source file>[,<file>]`.
2. It runs the test in a scratch copy with your source files reset to the base (must fail) and in your worktree (must pass), and records the proof for the report.
3. "not proved: the test passes without the change" → the test doesn't cover the behaviour; strengthen it. "fails with the change" → fix code or test.
4. For a bug fix, the regression test's proof (command and failure line) is mandatory.
