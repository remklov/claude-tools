# agents-progress

A Claude Code mod for the dev workflow (`dev-workflow` plugin): it shows what the workflow's agents do, in the terminal and in the Desktop app. It also shows any other subagents.

- **Agents pane**: every subagent with its avatar, description, role and tier (`implementer · M`), model, effort, status, step progress (`step 5/9 checks`), context fill, tokens and elapsed time. Tasks that are still being specified appear under "Planned". It opens by itself once per session at the first `dev-workflow:` agent; `/agents-progress` shows or hides it.
- **Avatars**: pixel crabs. Implementers wear the costume of their task's area (frontend painter, backend/data chef, infra engineer; several areas: plain crab), the reviewer is a detective, the investigator a scientist, `Explore` a pirate. The tier (`s` to `xl`) sets the accent colour and the badge. Running crabs walk unless the system asks for reduced motion; the terminal shows the badge only.
- **Task band** above the prompt: one line per active task with ticket, title, phase, `Round n/3` while reviewing, step progress while implementing, tier and the PR link; escalated tasks in red. A dim line lists tickets other sessions or machines hold (from the claim registry).

## Where the data comes from

- Tasks, phases, rounds, steps and PR links: `<git-common-dir>/dev-workflow/state.json`, which `cw` writes on every task transition. The mod checks the file's modification time every second and re-reads it right after a `cw …` Bash call. The model never has to report progress.
- Agent runs: the engine's `agent.spawn`, `turn.step`, `turn.complete` and `SendMessage` events. A run belongs to a task when its agent id or its description (the exact one `cw` printed) matches.
- Claims held elsewhere: `git fetch origin '+refs/claims/*:refs/dw/claims/*'` at most every two minutes while no agent runs.

The context fill assumes a window of 1M tokens, or 200k for Haiku models; the engine doesn't report a subagent's window.

Requires Claude Code 2.1.300 or later. Tested with 2.1.302.

## Develop

```bash
claude --plugin-dir ./plugins/agents-progress   # hot-reloads on save
claude plugin validate --strict ./plugins/agents-progress
claude plugin test ./plugins/agents-progress
```

## Attribution

The pixel crabs, the chef, engineer, detective and pirate costumes, their CSS motion, and parts of the event handling and pane layout are adapted from the [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) mod, published under the MIT License:

```text
MIT License

Copyright (c) 2026 johnnyvizz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
