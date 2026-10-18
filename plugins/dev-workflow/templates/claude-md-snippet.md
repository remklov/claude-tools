This repository uses the dev workflow from the `remklov` marketplace (plugins `dev-workflow` and `agents-progress`, enabled in `.claude/settings.json`).

- Start an orchestrator session with `claude --agent dev-workflow:orchestrator` and say "starte mit Ticket <ID>" or "nimm das nächste Ticket" (in any other session: `/dev-workflow:ticket <ID>`). The orchestrator claims the ticket first, so parallel sessions never take the same one; `cw ticket list` shows who works on what.
- It writes a testable spec, classifies it, delegates to a generalist implementer in its own worktree, runs the reviewer (up to the profile's review rounds) and, after your confirmation, pushes the branch and opens the PR. It never merges.
- Stack, packages, checks, guards and git conventions: `.claude/workflow/profile.json`. Rules are generated into `.claude/rules/workflow/` (never edit them by hand); project rules live in `.claude/workflow/rules/`. After a plugin update or a profile change run `cw rules build` and commit the result.
- What an agent gets: `cw playbook show <orchestrator|implementer|reviewer|investigator>`.
- Commit or discard changes to the backlog file and to files the ticket touches before starting it: the implementer's worktree starts from the main checkout's HEAD commit and sees nothing uncommitted.
