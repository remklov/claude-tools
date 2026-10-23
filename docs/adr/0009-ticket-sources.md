# 0009 Tickets from Jira, Linear or local files

- Status: accepted, 2026-10-23 (Acme Shop's tickets live in Linear)

## Context

PLAN R7 and D6 made Jira the only ticket source. Acme Shop, the first consumer, keeps its tickets in Linear and the technical details of a ticket in the outer repository, one file per key (`docs/specs/APP-123.md`). Some projects have no ticket system at all and write the tickets as files.

## Decision

`tickets.source` names the source: `jira` (the default until ADR 0010 made it `local`), `linear` or `local`. `tickets.contextPath`, a path relative to the project root with `{key}`, names a file per ticket:

- `jira` and `linear`: the ticket comes from the system's MCP server. The file of the key, when it exists, is technical context: the orchestrator reads it with the ticket, the snapshot keeps its path as `context`, and the brief names it for the agents.
- `local`: the file is the ticket, and `contextPath` is required (ADR 0010: it defaults to `docs/tickets/{key}.md`).

Linear is read through its read-only endpoint `https://mcp.linear.app/mcp/readonly`, which the project names in `.mcp.json` (project scope, shared with the team). `cw ticket context --ticket <KEY>` prints the source and the file of a key, so the orchestrator never builds the path itself.

## Consequences

- The orchestrator still reads a ticket once and never writes to it, whatever the source.
- `cw doctor` and `setup.sh` check the way to the tickets of the configured source: Atlassian's `atlassian` plugin, the Linear server in `.mcp.json`, or the folder of the local tickets.
- The snapshot schema takes `linear` and `local`, and the fields `path` and `context`; `cw ticket save` refuses a snapshot whose source differs from the config, or whose file is not the key's.
- The Linear tool name and its parameters are pinned by spike S11, not by documentation: Linear publishes its tools at runtime only.
- The entry hint is `<TICKET-KEY | NO-TICKET>`.
