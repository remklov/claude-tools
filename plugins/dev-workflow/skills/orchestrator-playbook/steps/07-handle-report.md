# O7 Handle the implementer's report

The implementer's final message is its saved report (JSON). Act on `status`:

- **done** → O8.
- **blocked** → answer the question from the spec, the plans or the code if you can and send the answer with SendMessage to the SAME agent; otherwise ask the user and send their answer. Dependency requests always go to the user.
- **misclassified** → `cw task phase --task <id> classify --note "<reason>"`, reclassify with the agent's reasons (O4), tell the user the old and new classification, confirm if the new one needs it (O5), then `cw task start` again; the new implementer gets a fresh worktree. Remove the old worktree only when it has no commits worth keeping (ask the user otherwise). In in-place mode follow reference/in-place-mode.md.
