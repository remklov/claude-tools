## Development workflow (dev-workflow)

- Start a task with `/dev-workflow:ticket <TICKET-KEY | {noTicketKey}> [notes]`. A session without the command is a normal session.
- The project config is `.claude/dev-workflow/config.json`; project rules live in `.claude/dev-workflow/rules/`.
- `.claude/rules/dev-workflow/` is generated: never edit it by hand. Rebuild it with `cw rules build` and commit the result.
- Set up or update the plugins and tools with `scripts/setup-dev-workflow.sh`, run in your own terminal.
- Inside Claude Code, `cw doctor` checks the setup and `cw help` lists the workflow commands.
