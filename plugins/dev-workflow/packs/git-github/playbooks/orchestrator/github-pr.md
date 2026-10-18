---
name: github-pr
role: orchestrator
description: Push the task branch and open the GitHub pull request; never merge.
when:
  phases: [deliver]
scripts: [git-github:pr-exists]
---
1. `gh auth status --hostname github.com`. Not logged in → give the user `gh auth login` and `gh auth setup-git` and wait.
2. `cw run git-github:pr-exists <branch>`. A URL means the PR exists: only push the new commits, then `cw pr record --task <id> --url <url>`.
3. `cw pr body --task <id>`; read it and pipe a corrected version into `cw pr body --task <id> --stdin` if anything reads wrong.
4. Ask the user for confirmation, naming exactly what is pushed (the task branch) and what a merge deploys (deploy-impact procedure, if active).
5. Push from the worktree: `git -C <worktree> push -u origin <branch>`.
6. `gh pr create --repo <owner/repo from origin> --base <base branch> --head <branch> --title "$(cw pr title --task <id>)" --body-file <pr-body.md>`.
7. `cw pr record --task <id> --url <url>`. Never merge the PR: the owner merges.
