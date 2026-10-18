---
name: setup
description: Set up or refresh the dev workflow in this repository (detect the stack, write the profile, compile the rules, check the environment).
argument-hint: "[--refresh]"
disable-model-invocation: true
---

Set up the dev workflow for this repository. Arguments: $ARGUMENTS

**With `--refresh`:** run `cw rules build --check` and `cw doctor --fresh`, explain what changed or is missing, and give the user the commands to fix it (`cw rules build`, then commit `.claude/rules/workflow/` and `.claude/workflow/rulebook.lock.json`).

**Otherwise:**
1. `cw doctor --fresh` if a profile exists already; otherwise `cw init --detect --json`.
2. Walk the user through the open questions with AskUserQuestion (at most 4 per round): ticket source, git conventions (branch and commit templates, keywords, trailers), package areas and checks, guards (ports, commands, dev servers), services the checks need, topics agents must never guess on.
3. Write the agreed profile to a temporary file (for example `$TMPDIR/dw-profile.json`) and validate it: `cw profile validate --file <file>`.
4. Tell the user to run in their own terminal (or with the `!` prefix): `cw init --write --profile <file>` — it writes `.claude/workflow/profile.json`, merges `.claude/settings.json`, adds `!.claude/workflow/` to an allowlist-style `.gitignore`, registers the backlog merge driver, inserts the instruction snippet into CLAUDE.md/AGENTS.md and compiles the rules.
5. Afterwards: `cw doctor`, `cw playbook show implementer`, and remind them to commit the new files and to start orchestrator sessions with `claude --agent dev-workflow:orchestrator`.
