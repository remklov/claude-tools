---
name: fisko-handover
role: orchestrator
description: What the owner must know before merging a fisko PR.
when:
  phases: [deliver]
---
1. A new migration must be applied to the dev database with the owner's consent before merging (`docs/LESSONS.md`); never apply it yourself.
2. Name the manual tests from `docs/MANUAL_TESTS.md` that the change needs and any MH live test.
3. A merge into `main` deploys every package a workflow in `.github/workflows/` watches; state which (deploy-impact).
4. Only the owner merges.
