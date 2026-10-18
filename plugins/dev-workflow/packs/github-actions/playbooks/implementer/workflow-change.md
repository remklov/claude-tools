---
name: workflow-change
role: implementer
description: Change GitHub Actions workflows safely.
when:
  paths: [".github/workflows/**"]
rules: [GHA-PIN, GHA-SECRETS]
scripts: [github-actions:deploy-impact]
---
1. Call out every change to what a merge deploys; `cw run github-actions:deploy-impact --task <id>` shows it.
2. Pin actions and images (GHA-PIN); secrets only from Actions secrets.
3. Say exactly what only a workflow run can verify (open point, tag `manual`).
