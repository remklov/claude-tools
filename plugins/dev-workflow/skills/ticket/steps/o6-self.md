# O6 Implement it yourself

Goal: for a complexity in `workflow.selfImplement` (default `s`), you do the implementer's work in this session, and the reviewer stays an agent of its own (ADR 0019). A small task is cheaper this way: no second context reads the code again. `cw task start` said so and wrote the brief. Hand it to an agent instead with `cw task start --task <id> --new-agent` when it turns out bigger, or when your context grows past about 150k tokens.

## Rules while you implement

- Edit and Write are open to you only inside the task's work tree (`cw ws setup` prints it): absolute paths under it. Every other project file stays closed (G-ORCH-EDIT).
- The implementer's guards hold for this session now: no push, no dependency commands, no blocked commands or ports.
- Never `cd`, and no git of your own on the task branch: `cw` runs the tests, the checks and the commit in the work tree.
- The implementer's rules hold too: tests first, change only what the task needs (CORE-SCOPE), no dependency changes (ask the user), never loosen a check.

## Steps

1. `cw ws setup --task <id>`: in-place it puts the app on the task branch. In worktree mode it adds `.claude/worktrees/self-<id>` on the task branch and links `node_modules`.
2. Read the brief `cw task start` named: its rules, procedures and guardrails, which the spec does not repeat. Then `cw context --task <id>`. Read the code the change touches.
3. Tests first: one or more per acceptance criterion, a regression test for a bug fix. Run one test with `cw test --task <id> --test <package>:<file>`. Then `cw step --task <id> --done 3`.
4. Implement. Then check your change against every rule of `cw rules applicable --task <id>`, as the reviewer will, and fix each violation. Then `cw step --task <id> --done 4`.
5. `cw checks --changed --task <id>` until it passes. Check each rule hint it prints against its rule.
6. `cw commit msg --task <id> --summary "<Imperative summary>" --keyword FEATURE --commit` stages every change of the work tree and commits it; then `cw commit lint --task <id>`.
7. `cw prove --task <id> --test <package>:<file> --change <file>` for each new test (a bug fix needs the regression proof).
8. Write the report JSON with the Write tool to a new file in your scratchpad, as the implementer playbook describes, with every field. Then pass it: `cw report save --task <id> < <scratchpad>/<id>-report-1.json`. A blocked or misclassified report works as there: you answer it with the user (O7).

Then O7: `cw task review --task <id>` starts the reviewer agent.

## Review findings

`cw task return --task <id>` prints the findings to fix and does not send them to anyone: fix them yourself with steps 3 to 8, save a new report, and continue with `cw task review --task <id>`. After `cw task cleanup` in worktree mode, `cw ws setup` adds the worktree again on the task branch.
