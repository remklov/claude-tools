# The spec

The spec is the contract between you, the implementer and the reviewer. The implementer's brief inlines it, `cw classify` reads its paths and words, and the reviewer checks every acceptance criterion against it. `cw spec lint` enforces the shape; the rest of this page is what lint cannot check.

## Shape

Start from the template of `cw spec show --task <id>`:

```markdown
## Task: <title>

**Ticket:** <KEY> · **Type:** <feature|bugfix|hotfix> · **Branch:** <branch>

### Context
### Requirements
### Acceptance criteria
### Non-goals
### Definition of done
```

- Keep the title line and the header line as `cw task new` wrote them; lint compares ticket, type and branch with the task.
- All five sections, in this order, with exactly these headings.

## Context

- Why the change is needed, in two or three sentences, and what the user decided in O2 (and later in O7).
- The affected modules and files as backticked paths relative to the work repo: `src/cart/cart.ts`. In in-place mode drop the app root prefix (`app/`); lint refuses it unless the work repo has a directory of that name itself. `cw classify` and the briefs use these paths.
- Relevant existing behaviour, with file and line where it helps the implementer.

## Requirements

- `- R1 …`, `- R2 …`: numbered from 1 without gaps or leading zeros. A dotted id (`R1.1`) is a note of its parent, not an item.
- One behaviour per requirement, stated from the outside (what the system does), not as an implementation plan.

## Acceptance criteria

- `- [ ] AC1 …`: numbered like the requirements. Every requirement is covered by at least one criterion.
- Each one is testable: an input or action and the observable result (a response, a rendered state, a stored value, an error message).
- Lint warns about vague wording such as "should work", "works correctly", "properly", "as expected" or "no errors": rewrite it with the concrete result.
- A bug fix has a criterion for the fixed behaviour; its regression test must fail on the unfixed code. Never write that every test fails on the unfixed code: only regression tests do (lint error).
- Acceptance criteria are always testable. A check only a person can do (a visual detail in a browser) is no criterion: it goes into the Definition of done as a manual check (below).

## Non-goals

What stays out, one line each: neighbouring features, refactors, dependency updates. `cw review scope` shows the reviewer the changed files that look like a non-goal.

## Definition of done

Keep the template's two lines (checks of every affected package pass; the applicable rules are met). Add only task-specific items, such as a migration note or a documentation update, and the manual checks the user wants: one line each, starting with `Manual check:` and saying what a person checks where (for example `Manual check: the empty cart shows the banner in the browser`). They need no test and no reviewer finding; the implementer lists each as an open point with tag `manual`, and the PR/MR body names it as not verified.

## Rule references

- Quote the rule ID and its wording, for example: CORE-DEPENDENCIES ("Don't add, remove or change dependencies in package manifests or lockfiles"). `cw rules show <ID>` prints the wording; `cw rules list` lists the active rules.
- Lint refuses an ID with a known rule prefix that is not active in the project.
- The spec wins over a rule, except a protected rule. A spec that needs to break a protected rule is wrong: ask the user and change the requirement.

## Claims and evidence

- A statement about how a library, framework, browser, API or tool behaves is backed by documentation (a link, the version) or marked as an observation with who saw it, where and with which version, for example: "Observation (staging, 2026-10-20): the API returns 404 for an unknown id."
- An assumption you could not check is written as an open question in O2, not as a fact.

## What never goes into a spec

- Attribution lines such as `Co-Authored-By` or "Generated with" (lint error).
- Implementation instructions beyond what the requirement needs: the implementer chooses how, within the guardrails.
- Secrets, tokens or personal data from the ticket.

## Language

The spec is written in `project.language.repo`. Product copy (UI texts, messages users read) is quoted in `project.language.productCopy` exactly as it must appear.
