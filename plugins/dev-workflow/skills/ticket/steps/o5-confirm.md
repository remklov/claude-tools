# O5 Confirm

Only for a complexity listed in `workflow.confirm` (default l and xl). The output of `cw classify --task <id> --set <c> --why "<one sentence>"` says when it applies, and `cw task start` refuses until the confirmation is recorded.

## 1. Show the user what will be built

One AskUserQuestion with a short summary, in the user's language:

- the requirements (R1 …) and acceptance criteria (AC1 …) in one line each;
- the non-goals;
- the complexity with its reason, the packages and areas from `cw classify`;
- for l and xl: what the guardrails demand (the contracts and callers, or the investigation first).

Options: "Go ahead", "Change the spec", "Change the complexity", "Stop".

## 2. Act on the answer

- Go ahead: record it with the user's words.

  ```bash
  cw task confirm --task <id> --note "<what the user confirmed>"
  ```

  Then O6.
- Change the spec: write the change (`cw spec save --task <id>`), lint it (`cw spec lint --task <id>`), classify again (O4) and come back here if the level still needs confirmation.
- Change the complexity: `cw classify --task <id> --set <c> --why "<the user's reason>"`; below the minimum only with `--override "<the user's reason>"`. Then ask again if the new level needs it.
- Stop: `cw task end --task <id> --outcome aborted --note "<the user's reason>"`, then the short report of O10.
