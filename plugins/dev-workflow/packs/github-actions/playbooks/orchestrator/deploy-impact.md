---
name: deploy-impact
role: orchestrator
description: Tell the user what a merge of this branch deploys.
when:
  phases: [deliver]
scripts: [github-actions:deploy-impact]
---
1. `cw run github-actions:deploy-impact --task <id>` (writes deploy-impact.json for the PR body).
2. Name the triggered deploy workflows in the confirmation question before pushing and in the final report.
