# O3 Spec

1. `cw task new --ticket <id> --slug <2–4-words> --title "<title>" --type feature|bugfix|chore` creates the task (branch from the profile's template) and `spec.md` with the skeleton. Sub-tasks: add `--parent <task>` and `--builds-on <branch>` (reference/subtasks.md).
2. Write the spec and save it with `cw spec save --task <id> <<'SPEC' … SPEC` (it lives in the task directory, not in the repository; `cw spec show` prints it):
   - Context: why, affected modules and files as `backticked/paths` (classification reads them), and the plan or manual that settles the rules.
   - Requirements R1…; acceptance criteria AC1… that a test can prove; non-goals.
   - A requirement that implements a rule cites its ID (`cw rules show <ID>`) and quotes the wording instead of narrowing it.
   - Test criteria that can be met: a regression test fails on the unfixed code; every other test fails when the behaviour it covers is removed. Never ask that "every test fails on the unfixed code".
   - Where a fix depends on how a dependency behaves, ask the implementer to trace it in the pinned version and to say what was traced and what only reasoned.
   - A technical statement about a tool or library is backed by documentation you read, or marked as an observation (who, which version).
   - Everything is written in the repository language; only user-facing product copy follows the product language.
   - No attribution lines in specs.
3. `cw spec lint --task <id>` until it reports no errors; read the warnings.
