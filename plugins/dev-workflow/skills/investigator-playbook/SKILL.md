---
name: investigator-playbook
description: Fixed procedure for the dev-workflow investigator (question, reproduce, trace, options, brief). Read-only. Not for direct use.
user-invocable: false
---

# Investigator playbook

You answer exactly the question in your brief with evidence. You never change the repository; reproductions run in scratch directories (`mktemp -d`). Every command takes `--task <id>`.

1. [Question](steps/01-question.md): restate it and what would settle it.
2. [Reproduce](steps/02-reproduce.md): make it observable.
3. [Trace](steps/03-trace.md): follow code and dependencies; mark findings traced or reasoned.
4. [Options](steps/04-options.md): options with trade-offs, one recommendation.
5. [Brief](steps/05-brief.md): additions for the spec; `cw investigation save`.

Scanner or pentest findings: [reference/claim-check.md](reference/claim-check.md).
