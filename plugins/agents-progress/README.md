# agents-progress

A Claude Code mod for the `dev-workflow` plugin of this marketplace: an Agents pane beside the chat and a band above the prompt with each active task.

- **Agents pane**: every subagent of the session with description, agent type, model, effort, the round of its task, status (running, done, failed), context fill, tokens and elapsed time. It opens by itself once per session, when the first dev-workflow agent starts. `/agents-progress` shows or hides it.
- **Avatars**: each agent is a pixel crab.
  - An implementer dresses for the area of its task: frontend a painter, backend a chef, infra an engineer. A task with several areas or none gives a plain crab.
  - The implementer's tier (`S` to `XL`) sets its accent colour and badge.
  - The reviewer is a detective, `Explore` a pirate, any other agent a plain crab.
  - Running crabs walk unless the system asks for reduced motion. The terminal shows the badge in the accent colour instead of a crab.
- **Status bar**: the bar under each agent shows its status, not its progress. While the agent runs, a stripe slides along it (it stands still under reduced motion, and in the terminal). A finished agent's bar is full, green when done and red when failed.
- **Task band**: one line per active task, in this order:
  - ticket, title and phase;
  - `Round n/3` while in review;
  - the tier, and `step n/8` while the implementer works;
  - the PR/MR link (https only).

  An escalated task shows in red. The band is hidden while no task is active, and what other mods draw there stays below these lines.

The context fill assumes a window of 1M tokens, or 200k for Haiku models: the engine doesn't report a subagent's window.

## Where the tasks come from

`cw` writes the tasks to `state.json` in `dev-workflow/` under the git common dir.

- **Finding it:** the mod walks up from the session's directory to `.claude/dev-workflow/config.json`. It then asks `git rev-parse --git-common-dir` there, which also answers in a linked worktree.
- **Reading it:** once a second, only when its modification time changed, and right after each Bash call that starts with `cw `.
- **When it is broken or gone:** invalid JSON keeps the last good state. Without the file, or outside a dev-workflow project, the band stays hidden and the pane lists the agents alone.

The mod makes no network call and runs no git fetch.

## Requirements and install

Mods need Claude Code 2.1.287 or later in the terminal, and 2.1.286 or later in the Desktop app. The tests run against the engine you have installed: `claude plugin test` (Claude Code 2.1.308 when this was written).

The mod reads what `dev-workflow` writes but does not depend on it, and neither plugin installs the other. Enable it next to `dev-workflow` from the `remklov` marketplace.

## Develop

Load the folder for one session; Claude Code hot-reloads a mod loaded this way when a file changes:

```bash
claude --plugin-dir <repo>/plugins/agents-progress
```

From this folder:

```bash
claude plugin validate --strict .
```

```bash
claude plugin test .
```

Claude Code writes its type declarations to `.claude-plugin/types/` when it loads the mod (ignored by git); `tsconfig.json` extends them for the editor.

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
