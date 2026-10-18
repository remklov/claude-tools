# Implementation notes (v0.1.0)

Where the implementation deliberately differs from or adds to the specs. The specs stay the design reference; these notes win where they disagree.

| Topic | Spec | Implemented |
|---|---|---|
| CQ aliases | Pack rule meta `aliases=CQ-n` | Project mapping in the profile: `rules.aliases` (alias → rule ID or list). Pack rules stay free of project numbering; the meta field still works for pack-internal renames |
| Conditional rules | — | Rule meta `when=option:<name>[=<value>]` keeps a rule only if the pack option matches (TS-ESM-IMPORTS, RTL-CLEANUP) |
| Dependencies at intake | `cw intake` exits 3 on open dependencies | `cw intake <id>` claims with a warning (the dependency column often holds soft prerequisites); `cw intake --next` skips tickets with open dependencies |
| Garbage collection of claims | Release when the row is gone from the default branch | Only for claims whose row was on the default branch at intake (`onBase`), so rows added inside a task branch are not released early; others go when stale |
| Orchestrator writes | Edit the spec file | The orchestrator agent has no Edit/Write: `cw spec save --task <id>` (stdin), `cw spec show`, `cw pr body --stdin` |
| Single test command | `{name: -t "{name}"}` template | `testRunner: { single: "npx vitest run {file}", nameFlag: "-t" }` (pack) or `packages[].test` (profile) |
| Pack guards | `guards.commands` | Plus `guards.dependencyCommands` (G-DEPS); docker `runningStackCommands` and postgres `devDatabasePort` feed the guards |
| Worktrees without a committed profile | — | `cw` falls back to the main checkout's profile, rules and procedures (`ctx.configRoot`) |
| Hook modules | One file per hook | Logic in `guard-rules.mjs` and `intent.mjs` (testable); entry files only run the hook |
| `cw run` arguments | Positional only | Everything after `<pack>:<script>` is passed through except `--task`/`--cwd`/`--json` |
| Doctor | Core checks gh/glab | Host CLI checks live in the host packs (git-github) |
| Ticket adapters | Separate files | `lib/ticket/index.mjs` (github-issues, none) and `markdown-table.mjs` |
