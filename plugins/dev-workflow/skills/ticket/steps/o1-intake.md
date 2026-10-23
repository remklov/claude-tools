# O1 Intake

Goal: a working setup, no second task for the same ticket, and the ticket's content in front of you.

## 1. Setup

Run `cw doctor --quick`.

- An `ERROR` line: stop. Explain the finding and its `Fix:` to the user; continue only after it is fixed (or the user tells you to go on anyway for a warning-level issue).
- `warn` lines: mention them in one sentence each. A warning about the ticket source (the `atlassian` plugin not enabled, no Linear server in `.mcp.json`) means the ticket read below will not work: plan for a pasted ticket.

## 2. The argument

- First word = the ticket key. A ticket key matches `tickets.keyPattern` (`cw config show`); `NO-TICKET` (or the configured `git.noTicketKey`) means no ticket.
- The rest = the user's notes. Keep them; they feed O2 and the spec.
- Anything else as the first word (a sentence, a URL): ask the user for the key. A Jira or Linear URL contains it.

## 3. Active tasks

Run `cw task list` to see every active task, then:

- **A ticket key:** `cw task list --ticket <KEY>`. If it lists a task, show its id, phase and owner session and ask the user whether to continue it in this session.
  - Yes: `cw task new --rebind <id>`. Its output names the task's phase, the next command and the agents of the earlier session. Continue at the step of that phase (the table "Where you are" in the skill) with that command, and skip the rest of O1–O3. Agents of the earlier session get a fresh Agent call, never a SendMessage (`cw` prints the right command).
  - No: ask whether the old task is to be dropped. Only with a yes: `cw task end --task <id> --outcome aborted --note "<the user's reason>"`, then `cw task cleanup --task <id>`. Otherwise stop: `cw task new` refuses a second active task for the key.
- **NO-TICKET:** never rebind on your own. `cw task list --ticket NO-TICKET` lists the active no-ticket tasks; if there are any, ask whether one of them is meant (then `cw task new --rebind <id>`) or a new task starts.
- **In-place mode** (`workspace.mode` in `cw config show`): only one started task can hold the app's work tree. If another task is in implement, review or deliver, tell the user now; `cw task start` will refuse until it is finished or dropped.

## 4. The ticket

Run `cw ticket context --ticket <KEY>`. It names the ticket source (`tickets.source`) and the file of the key:

- **jira** or **linear:** read the issue with exactly the one call that `cw playbook read reference/jira.md` (Jira) or `cw playbook read reference/linear.md` (Linear) describes. No other calls, no writes.
- **local:** the file it names is the ticket; read it as `cw playbook read reference/local.md` describes. Exit 3 means there is no such file: tell the user and ask for the right key.
- **A context file** (jira or linear) that exists: read it with the Read tool. It holds technical requirements and implementation details for the ticket: they feed O2 and the spec, and its path goes into the snapshot as `context`.
- The ticket cannot be read (the tool is missing, not logged in, or the call fails): tell the user (the one-time `/mcp` login fixes a missing login) and ask them to paste the ticket text, or to confirm that the notes are the whole requirement.
- NO-TICKET: the notes are the ticket. If they are thin, O2 fills the gaps.
- If `.claude/plans/<KEY>.md` exists (a kickoff plan, if the project writes one), read it: it is input for the spec, not a spec. Its claims about the code are checked against the code.

## 5. Understand the code

Read what the ticket touches before you ask questions or write the spec: with the Read, Grep and Glob tools and `git -C <appRoot> ls-files` from the project root, never with `cd` (ground rule 2). For a wide search across the codebase use the Explore agent: an Agent call with `subagent_type: "Explore"`, your question as the prompt and, where the Agent tool has that parameter, `run_in_background: false`; no `model`, no `effort`. Wait for its result before you go on to O2: without the parameter (the interactive CLI, the Desktop app) the call returns at once, and the result arrives later as a message. In in-place mode the application code is under the app root, and paths in the spec are relative to it.

Done when: you know the ticket, the notes, the plan file if any, and the code it touches. Continue with O2.
