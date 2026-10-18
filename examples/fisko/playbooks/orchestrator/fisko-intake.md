---
name: fisko-intake
role: orchestrator
description: Fisko backlog rules for picking and preparing a ticket.
when:
  phases: [intake]
---
1. `plan/NEXT_STEPS.MD` is the master list; `cw intake` already checked open status, dependencies and the claim.
2. Check `docs/FEATURES.md` and grep the code before treating anything as missing or building something "new".
3. Scan `docs/LESSONS.md` before tickets that touch DGII integration, migrations, dependencies or the dev environment.
4. Docs-only work (`plan/`, `docs/`, `PROJECT.md`) is not delegated: release the claim and tell the user to make it in a regular session.
