# Message templates

Prefer the texts `cw` prints (`cw task return`, `cw task review`, `cw base-moved`). For cases without one:

- **Answer to blocked:** "Answer to your question: <answer>. Source: <spec section, plan, file:line>. Continue with your playbook from the step you stopped at and finish with `cw report save --task <id>`."
- **Foreign commits:** "Your branch contains commits that aren't part of this task: <list>. Rebase your own commits onto the base: `git rebase --onto <base commit> <last foreign commit>`, rerun `cw checks --changed --task <id>` and report again."
- **Spec change after approval:** "The spec changed: <diff in words>. The updated spec is in <path>. Implement the change on the same branch, rerun the checks and report again; the review cycle starts over."
