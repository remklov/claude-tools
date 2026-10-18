# O4 Classify

1. `cw classify --task <id>` maps the spec's paths to packages and areas, computes the minimum complexity from the profile's escalation rules, recommends a split, and lists the procedures that apply.
2. Choose the complexity (reference/complexity.md); if between two levels, take the higher one. Never below the minimum unless the user approves an override.
3. `cw classify --task <id> --set <s|m|l|xl> --why "<one sentence>"` (add `--override "<the user's reason>"` only after the user approved going below the minimum).
4. Split recommended → create sub-tasks in the printed order (reference/subtasks.md). Otherwise one implementer does the whole task, even across packages.
5. Unowned paths (outside every package) → check the profile; tell the user if a package is missing.
