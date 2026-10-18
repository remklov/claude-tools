#!/usr/bin/env sh
# Local gate before pushing: the same checks as CI, including the forbidden-terms check.
set -e
root="$(git rev-parse --show-toplevel)"
cd "$root"
node --test plugins/dev-workflow/tests/unit/*.test.mjs > /dev/null
node plugins/dev-workflow/tools/generate-agents.mjs --check
node plugins/dev-workflow/tools/repo-lint.mjs
node plugins/dev-workflow/tools/repo-lint.mjs --terms --range "origin/main..HEAD"
claude plugin validate --strict . > /dev/null
claude plugin validate --strict plugins/dev-workflow > /dev/null
claude plugin validate --strict plugins/agents-progress > /dev/null
claude plugin test plugins/agents-progress > /dev/null
echo "prepush ok"
