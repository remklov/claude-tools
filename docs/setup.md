# Setup

`setup.sh` in the repository root sets up or updates the `dev-workflow` plugins for one project. It is a guided script: every step checks first, explains what it would change, acts only with your consent and verifies the result. Running it again is the update path. The contract is `docs/PLAN.md` §12; this page is the user's view.

## Run it

Run it in your own terminal, never inside Claude Code: it changes plugin settings, which Claude Code protects in a session, and refuses there.

The first time, from a clone of the marketplace, in the root of the project that should use the workflow:

```bash
git clone --depth 1 git@github.com:remklov/claude-tools.git /tmp/dw
```

```bash
/tmp/dw/setup.sh
```

Pass `--project <dir>` to run it for another directory; setup.sh works on that directory's git root. In a project that is set up already, run the committed bootstrap instead. It clones the marketplace into a temporary directory, runs its `setup.sh` for the project and removes the clone again:

```bash
scripts/setup-dev-workflow.sh
```

### Requirements

| Tool | Version | Why |
|---|---|---|
| git | 2.31 or later | the work trees, branches and the marketplace clone |
| Node | 20 or later | `cw`, the hooks and setup.sh's own JSON handling |
| Claude Code | 2.1.296 or later | the plugin commands with `--json` and the mod API (`claude update` updates it) |
| SSH key for github.com with access to `remklov/claude-tools` | usable without a passphrase prompt | The marketplace is private; Claude Code fetches it with git over SSH and reads no token |
| gh or glab | logged in to the work repo's host | `cw pr command` asks it for an existing PR/MR before it prints the create command |

## Answers and flags

setup.sh reads one answer per question from stdin. In a terminal you type it; `[Y/n]` means Enter is yes, `[y/N]` means Enter is no. Without any answer (stdin closed), every question counts as no, so a script that pipes nothing changes nothing.

| Flag | Effect |
|---|---|
| `--project <dir>` | The project; default the current directory |
| `--yes` | Accept every default without asking. agents-progress stays off unless `--with-progress` |
| `--with-progress` | Install the agents-progress display for you in this project |
| `--no-progress` | Do not offer agents-progress |
| `--check` | Report what is set up and what is missing; change nothing. Exits 1 when something is missing |
| `--skip-plugins` | Skip the SSH check, the marketplace and the plugin installs |

## The steps

| Step | Checks | Changes, with consent |
|---|---|---|
| 1 Project | The git root of the directory; refuses the marketplace repository itself and runs inside Claude Code | – |
| 2 Prerequisites | git, Node 20+, Claude Code 2.1.296+ | – (stops with the fix) |
| 3 SSH | `ssh -T -o BatchMode=yes git@github.com` (GitHub's exit 1 with "successfully authenticated" counts as success) | – (stops with the key setup: `ssh-add`, the `~/.ssh/config` block, `known_hosts`) |
| 4 Marketplace | Whether `remklov` is registered, and from which source | Removes a same-name registration of another source (default no); `claude plugin marketplace add remklov/claude-tools --scope project` (github source), then `marketplace update` |
| 5 Plugins | Whether the plugins are installed and enabled | `claude plugin install dev-workflow@remklov --scope project`, then `update`; agents-progress with `--scope local` only on request (default no) |
| 6 Git host | The work repo's `origin` (the app root in in-place mode) | Offers `gh auth login` or `glab auth login` for that host, in a terminal only |
| 7 Tickets | The way to the tickets of `tickets.source` (an existing config; else `local`): nothing for `local`, Atlassian's `atlassian` plugin enabled (`jira`), a Linear server in `.mcp.json` (`linear`) | – (names `claude plugin install atlassian@claude-plugins-official --scope project`, or `claude mcp add --transport http --scope project linear https://mcp.linear.app/mcp/readonly`; `/mcp` logs in) |
| 8 Local binding (macOS) | `sandbox.network.allowLocalBinding` in `~/.claude/settings.json` | Sets it, keeping every other key; it applies to all your projects |
| 9 Project config | `.claude/dev-workflow/config.json` | `cw init --interactive` |
| 10 Check | `cw rules build --check`, `cw doctor --fresh` | Rebuilds drifted rules |

The `claude plugin` commands run with the project root as their working directory, so `--scope project` always writes `<project>/.claude/settings.json`. setup.sh passes `--json` and reads the result line (`{ command, outcome, message }`), so a failure names its reason.

## What it writes, and what to commit

| File | Written by | Commit it |
|---|---|---|
| `.claude/settings.json` | marketplace add and the project-scope install: `extraKnownMarketplaces` and `enabledPlugins`; `cw init`: permissions, env, worktree settings | yes |
| `.claude/settings.local.json` | the local-scope install of agents-progress | no (your own) |
| `.claude/dev-workflow/config.json`, `.claude/rules/dev-workflow/`, the rulebook lock, the `CLAUDE.md` section, `scripts/setup-dev-workflow.sh` | `cw init` | yes |
| `~/.claude/settings.json` | step 8 | – (your user settings) |

At the end setup.sh lists the project files that changed. Commit them so teammates get the same setup; they then run `scripts/setup-dev-workflow.sh` once, which installs the plugins for themselves.

The first `marketplace add` and the first project-scope install rewrite `.claude/settings.json` with reordered keys. When the content did not change, setup.sh puts the original bytes back, so a re-run leaves the file as it was.

## Update and remove

Run `scripts/setup-dev-workflow.sh` again: it refreshes the marketplace and updates the installed plugins. A new plugin version loads in the next Claude Code session.

To remove the plugins from a project, in its root:

```bash
claude plugin uninstall dev-workflow@remklov --scope project
```

```bash
claude plugin uninstall agents-progress@remklov --scope local
```

`claude plugin marketplace remove remklov` also removes the marketplace; from the last scope that declares it, it uninstalls every plugin of it.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Step 3 stops | The key needs a passphrase prompt, or the agent holds no key. Load it (`ssh-add --apple-use-keychain ~/.ssh/<key>` on macOS), add the `~/.ssh/config` block setup.sh prints, and accept the host key once with `ssh -T git@github.com`. Check the access with `git ls-remote git@github.com:remklov/claude-tools.git`. With a password manager's SSH agent, unlock it first |
| "registered from directory …" in step 4 | A local marketplace of the same name hides the git one, and its plugins then report "not found in marketplace". Let setup.sh remove it, or remove it yourself with `claude plugin marketplace remove remklov` |
| The Desktop app shows no `/dev-workflow:` commands | The Desktop app loads the plugins once `marketplace add` and `install` ran; it shows no trust dialog and ignores a committed declaration alone. Run setup.sh (or the bootstrap) once on that machine |
| setup.sh refuses with "Claude Code protects" | It ran inside a Claude Code session (`CLAUDECODE=1`). Run it in a terminal |
| `cw doctor` warns about allowLocalBinding | Step 8 was declined. Tests that bind a port (supertest) fail under the sandbox without it |
| The workflow cannot find gh or glab | Install it (`brew install gh` or `brew install glab`) and log in for the host step 6 names |

## Develop setup.sh

`tests/setup.test.sh` runs setup.sh against stub `claude`, `ssh`, `gh`, `glab` and `uname`, with a temporary `HOME` and project:

```bash
bash tests/setup.test.sh
```

CI runs it in the `setup` job, which also lints every shell script with `shellcheck`.
