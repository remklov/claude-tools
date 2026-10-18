---
name: migration-handover
role: orchestrator
description: Remind the owner that a new migration needs their consent before it reaches a shared database.
when:
  phases: [deliver]
  paths: ["{options.dir}/**"]
---
1. If the branch adds a migration, say so in the confirmation question and in the final report.
2. The owner applies it to the development database with their consent before merging; never apply it yourself.
3. Name the deploy step in the PR's migrations section.
