# 9 Report

1. Pipe your part of the report into `cw report save --task <id>` (format: reference/report-format.md). `cw` adds branch, worktree, changed files, checks and proofs and validates everything against the spec.
2. Fix what it rejects (an AC without evidence, failing checks) and save again.
3. Your final message is exactly the JSON block `cw report save` printed — nothing before or after it.
