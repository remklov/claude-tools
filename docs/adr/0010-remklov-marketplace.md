# 0010 The remklov marketplace: local tickets by default, GitHub, neutral defaults

- Status: accepted, 2026-10-23 (the rebuilt workflow moved into `remklov/claude-tools`)

## Context

The v1 rebuild was planned for another organisation's GitLab, ticket system and conventions. It now lives in the owner's private marketplace `remklov` on GitHub, which serves projects of any kind; fisko is the first real consumer. Names of the former context must not appear in the repository, its paths or its history.

## Decision

- `tickets.source` defaults to `local`, with `tickets.contextPath` `docs/tickets/{key}.md`. Jira and Linear stay available (ADR 0009). `cw init` proposes `local`, and setup.sh checks `local` when no config exists.
- Jira is read through Atlassian's own plugin `atlassian@claude-plugins-official`; `tickets.site` has no default.
- The git preset is `default` (`presets/git/default.json`), the former conventions unchanged.
- The marketplace is `remklov`, declared as the github source `remklov/claude-tools` and cloned over SSH. setup.sh treats GitHub's `ssh -T` answer (exit 1 with "successfully authenticated") as success.
- CI runs on GitHub Actions. repo-lint checks a private list of terms, read from `FORBIDDEN_TERMS` (a CI secret) or `~/.config/claude-tools/forbidden-terms`, in files, paths, commit messages and commit authors; the list itself never enters the repository.

## Consequences

- A project without a ticket system works without any setup: one Markdown file per ticket.
- Existing configs that relied on the `jira` default must name `"source": "jira"`.
- The example project of the docs and tests is the fictional "Acme Shop", with ticket keys like `APP-42`.
- `tools/install-hooks.sh` installs the same checks as `commit-msg` and `pre-push` hooks.
