#!/usr/bin/env sh
# Local gate before a push: the checks of CI, with the private-terms list from
# ~/.config/claude-tools/forbidden-terms over the files and the commits not yet on origin/main.
set -e
root="$(git rev-parse --show-toplevel)"
cd "$root"
node --test plugins/dev-workflow/tests/*/*.test.mjs >/dev/null
node --test tests/dry-run/make-project.test.mjs >/dev/null
node plugins/dev-workflow/tools/generate-agents.mjs --check
node plugins/dev-workflow/tools/repo-lint.mjs --range origin/main..HEAD
bash tests/setup.test.sh >/dev/null
if command -v shellcheck >/dev/null; then git ls-files -z '*.sh' | xargs -0 shellcheck; fi
claude plugin validate --strict . >/dev/null
claude plugin validate --strict plugins/dev-workflow >/dev/null
claude plugin validate --strict plugins/agents-progress >/dev/null
claude plugin test plugins/agents-progress >/dev/null
echo "prepush ok"
