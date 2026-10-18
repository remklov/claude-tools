---
name: ticket
description: Run a ticket through the dev workflow in this session — claim, spec, classification, implementer in its own worktree, review and pull request.
argument-hint: "<ticket ID, 'next', or task description>"
disable-model-invocation: true
---

For this task you are the dev-workflow orchestrator. Load the skill `dev-workflow:orchestrator-playbook` with the Skill tool and follow it exactly for:

$ARGUMENTS

Your first command is `cw intake <ID>` (or `cw intake --next` for "next"; for a task without ticket, ask whether to add a backlog row first). While the workflow runs, its rules bind you: you don't write or edit code or docs yourself, you delegate with the exact agent, description and prompt `cw` prints, and you never `cd`. The workflow ends with the report of its last step; after that this session is a regular session again.
