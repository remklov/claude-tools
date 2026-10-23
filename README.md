# claude-tools

The private Claude Code marketplace `remklov` (repository `remklov/claude-tools`). It holds two plugins:

- `dev-workflow`: an orchestrated multi-agent development workflow with generalist agents, role playbooks, stack rule packs and the deterministic `cw` CLI. A session starts it with `/dev-workflow:ticket <TICKET-KEY | NO-TICKET>`.
- `agents-progress`: an optional mod that shows the workflow's agents and tasks.

## Quickstart

In your own terminal (not inside Claude Code), in the root of the project that should use the workflow:

```bash
git clone --depth 1 git@github.com:remklov/claude-tools.git /tmp/dw
/tmp/dw/setup.sh
```

setup.sh checks Node, Claude Code and SSH access to GitHub (the repository is private), installs `dev-workflow` for the project, offers `agents-progress` for you and runs `cw init`; it asks before every change. Commit the files it lists, then open Claude Code in the project, trust the folder and run `/dev-workflow:ticket <TICKET-KEY | NO-TICKET>`. Teammates and updates run `scripts/setup-dev-workflow.sh`. Details: [docs/setup.md](docs/setup.md).

## Documentation

| Page | What |
|---|---|
| [docs/setup.md](docs/setup.md) | setup.sh: steps, flags, what it writes, troubleshooting |
| [docs/architecture.md](docs/architecture.md) | How the plugins, roles, `cw`, the task state and the hooks fit together |
| [docs/playbooks.md](docs/playbooks.md) | The orchestrator, implementer and reviewer playbooks |
| [docs/config.md](docs/config.md) | The project config `.claude/dev-workflow/config.json` |
| [docs/packs.md](docs/packs.md) | The stack packs and their rules |
| [docs/extending.md](docs/extending.md) | Project rules, new packs, agents, guards and skills; the checks before a pull request |
| [docs/adr/](docs/adr/README.md) | The owner decisions taken during the build |
| [docs/dry-run.md](docs/dry-run.md) | The manual acceptance checklist |
| [docs/migration/cq-rules.md](docs/migration/cq-rules.md) | A legacy CQ rule set (example project Acme Shop) mapped to the packs |
| [docs/PLAN.md](docs/PLAN.md) | The build plan and the verified platform facts |

## Layout

| Path | What |
|---|---|
| `.claude-plugin/marketplace.json` | The marketplace: both plugins by relative path |
| `setup.sh`, `tests/setup.test.sh` | The guided setup and its tests |
| `plugins/dev-workflow/` | Agents (`agents/`), the `cw` CLI (`cli/`, shim `bin/cw`), packs (`packs/`), the git preset (`presets/`), schemas (`schemas/`), `init` templates (`templates/`), skills (`skills/`), hooks (`hooks/`), tools (`tools/`) and tests (`tests/`) |
| `plugins/agents-progress/` | The mod: hooks module, types and tests |
| `tests/dry-run/` | The dry-run kit: `make-project.mjs` builds a mini project for `docs/dry-run.md` |

## Develop

See [CLAUDE.md](CLAUDE.md) for the conventions and [docs/extending.md](docs/extending.md) for the checks to run before a pull request.
