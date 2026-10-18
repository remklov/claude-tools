# 8 Commit

1. Stage your changes with `git add`.
2. `cw commit msg --task <id> --summary "<imperative summary>" [--body-file <file>] --out <tmp file>` builds the message in the project's format (template, length, wrapped body, trailers).
3. Append your attribution lines if your instructions require them, then `git commit -F <tmp file>`.
4. `cw git lint --task <id>` checks the branch name and every commit of the task; fix findings with a new commit or by amending your own last commit.
5. Never push. Review-fix commits go on the same branch.
