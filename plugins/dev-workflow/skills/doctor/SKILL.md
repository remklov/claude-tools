---
name: doctor
description: Check the dev-workflow setup of this project with cw doctor --fresh and explain every finding with its fix. Use when the workflow does not start, a session start reports dev-workflow setup issues, or the user asks to check the setup.
---

# Setup check

## 1. Run

`cw doctor --fresh` checks again instead of using the cached result (the session start uses a cache of up to 12 hours). It needs no network.

- Exit 0: every check passed, or only warnings.
- Exit 1: at least one error; the workflow will not work reliably until it is fixed.
- Exit 3 "No .claude/dev-workflow/config.json …": the project is not set up. The user runs the setup script (`scripts/setup-dev-workflow.sh`, or setup.sh from the marketplace repository) or `cw init --interactive` in their own terminal; `cw init` refuses to write inside Claude Code.

## 2. Explain each finding

Each line starts with `ok`, `warn` or `ERROR`, then the message and, when not ok, `Fix:`. For every `warn` and `ERROR` line say in one or two sentences what it means for the workflow and what the fix is:

| Check | What a failure means |
|---|---|
| Node, git | `cw` and the hooks need Node 20 or later and a recent git; nothing runs reliably without them |
| Claude Code | older than the minimum version the workflow was verified on |
| config | `.claude/dev-workflow/config.json` is invalid; `cw config validate` lists every field with its problem |
| work repo | in-place mode: the app root is not a git repository of its own (the application is not cloned there yet) |
| state dir | `cw` cannot write the task state under the git directory |
| host CLI | `gh` or `glab` is missing for the work repo's host; delivery (push and PR/MR) will not work |
| packs | a pack of the config does not resolve; nothing that needs rules works |
| rules | the compiled rules under `.claude/rules/dev-workflow/` are out of date or do not compile; agents would follow old rules |
| atlassian, linear-mcp, ticket-files | the way to the tickets of `tickets.source` is missing: the Jira plugin, the Linear server in `.mcp.json`, or the folder of the local ticket files; the orchestrator asks to paste tickets instead (a local ticket cannot start) |
| allowLocalBinding (macOS) | sandboxed API tests and dev servers fail with EPERM |

Quote the printed `Fix:` exactly; it names the command and where it runs.

## 3. Fixes

- Fixes that change user or project settings, install tools or log in (`setup.sh`, `claude update`, `brew install …`, `gh auth login`, `glab auth login`, the `/mcp` login) are the user's: name them, do not run them.
- `cw rules build` rewrites `.claude/rules/dev-workflow/`; the result must be committed. Run it only when the user asks you to, then show what changed.
- After the user fixed something, run `cw doctor --fresh` again and confirm the result.

End with one line: ready for `/dev-workflow:ticket <KEY>`, or what still blocks it.
