# O5 Confirm

Needed when the chosen complexity is in the profile's `workflow.confirm` (default l and xl); `cw task start` refuses otherwise.

1. Show the user the spec summary (title, requirements, acceptance criteria, non-goals) and the classification with its justification.
2. AskUserQuestion: confirm, change the spec, or change the complexity.
3. `cw task confirm --task <id> --note "<what the user confirmed>"`.
