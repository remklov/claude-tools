# O6 Delegate

Goal: the implementer agent of the chosen complexity works on the task, and its id is recorded.

## 1. Start the round

```bash
cw task start --task <id>
```

- `--base <branch>` only when the user wants another base than `git.defaultBase`; it must be a local branch of the work repo.
- Refusals name their fix: a spec with lint errors, a missing confirmation, a pending reset after a misclassification, or (in-place) another task that holds the app's work tree. Ask the user where the fix needs a decision.

The output contains the brief file, the selected rules and procedures, and:

```text
Call the Agent tool with exactly these parameters:
```

followed by a JSON fence.

## 2. Call the agent

Call the Agent tool with that JSON as it is:

- `subagent_type` (`dev-workflow:implementer-<level>`), `description` and `prompt` unchanged;
- `run_in_background: false` where the Agent tool has that parameter, so the call returns when the implementer has ended; without it (the interactive CLI, the Desktop app) the implementer runs in the background, and its report arrives later as a message (ground rule 10);
- `isolation: "worktree"` only when it is printed (worktree mode); never add it yourself;
- nothing else: no `model`, no `effort`, no extra text in the prompt. The brief file carries everything.

If the call is refused or fails, run it again exactly as printed once; if it still fails, tell the user what the error says.

## 3. Record the agent

The Agent result names the agent id. Record it for later SendMessages:

```bash
cw task agent --task <id> --role implementer --id <agentId>
```

Then O7, once the implementer has ended: `cw report show --task <id>`. Do not judge the work from the Agent result text; it may only point to a handback.

## Later rounds

`cw task return`, `cw task review` and `cw task start --task <id> --new-agent` print either a SendMessage for the same agent or a fresh Agent call. A fresh Agent call is always followed by `cw task agent --task <id> --role <implementer|reviewer> --id <agentId>` for its role; a SendMessage keeps the recorded id.
