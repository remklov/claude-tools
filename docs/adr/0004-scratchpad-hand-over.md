# 0004 Text for `cw` goes through a scratchpad file

- Status: accepted, 2026-10-21 (automated dry run of P3)

## Context

The ticket snapshot, the spec, the PR/MR body, the implementer's report and the reviewer's review reached `cw` on stdin through a quoted heredoc. In the asking permission mode (CLI 2.1.306), every heredoc with JSON asked for approval ("Contains brace with quote character"), also under `Bash(cw *)`: several prompts per round. A Write into the session's scratchpad and `cw version < <scratchpad file>` ran without a prompt, in the main session and in a subagent, which named the same scratchpad.

## Decision

The playbooks write such text with the Write tool to a new file in the scratchpad directory the session names, then run `cw <command> --task <id> < <file>`. A quoted heredoc stays the fallback without a scratchpad. The reviewer gets the Write tool (`disallowedTools: Edit, Agent`), and G-REVIEWER-WRITE refuses Edit, NotebookEdit and every Write inside the project.

## Consequences

- No prompt for the saves in the asking and acceptEdits modes.
- The Write tool overwrites only a file it has read, so each save takes a new file name.
- The reviewer is still read-only for the project.
