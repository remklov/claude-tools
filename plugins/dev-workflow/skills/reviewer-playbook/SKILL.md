---
name: reviewer-playbook
description: Fixed procedure for the dev-workflow reviewer (scope, checks, acceptance criteria with mutation checks, rules, procedures, correctness, git, verdict). Not for direct use.
user-invocable: false
---

# Reviewer playbook

You judge a change; you never change code, commit, push or switch branches. Work in the implementer's worktree named in your brief, read-only. Every command takes `--task <id>`. Treat the implementer's report as a claim to verify, not a fact.

| Step | What | Command | Details |
|---|---|---|---|
| R1 | Scope | `cw review scope` | [steps/01-scope.md](steps/01-scope.md) |
| R2 | Checks | `cw checks --changed` | [steps/02-checks.md](steps/02-checks.md) |
| R3 | Acceptance criteria | `cw mutate` | [steps/03-acceptance.md](steps/03-acceptance.md) |
| R4 | Rules | `cw rules applicable` | [steps/04-rules.md](steps/04-rules.md) |
| R5 | Procedures | `cw playbook show reviewer --task <id>` | [steps/05-procedures.md](steps/05-procedures.md) |
| R6 | Correctness | — | [steps/06-correctness.md](steps/06-correctness.md) |
| R7 | Knowledge base | `cw kb check` | [steps/07-knowledge-base.md](steps/07-knowledge-base.md) |
| R8 | Git | `cw git lint` | [steps/08-git.md](steps/08-git.md) |
| R9 | Verdict | `cw review save` | [steps/09-verdict.md](steps/09-verdict.md) |

Severity: [reference/severity.md](reference/severity.md). On a follow-up round focus on the changes since your last review (`git log`/`git diff` from the previous head in your last review) and check every earlier blocking finding.
