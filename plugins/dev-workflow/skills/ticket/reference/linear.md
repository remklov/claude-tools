# Linear intake

With `tickets.source` linear the workflow reads each ticket once, in O1, through the Linear MCP server, and never writes to it. The project connects Linear's read-only endpoint `https://mcp.linear.app/mcp/readonly` in its `.mcp.json`; `cw doctor` checks that and names the server.

## The one call

Tool: `mcp__<server>__get_issue`, where `<server>` is the name of the Linear server in `.mcp.json` (for example `mcp__linear__get_issue`). If your tool list shows it as deferred, load its schema first (ToolSearch with `select:mcp__<server>__get_issue`).

```json
{ "id": "<KEY>" }
```

- The result is one JSON object: `id` (the key), `title`, `description` (Markdown), `status` (the state's name), `labels`, `assignee` (a name), `url`, and more you do not need.
- No other Linear calls: no search, no comments, no lists.

## When Linear is not available

- The tool is missing: the project's `.mcp.json` has no Linear server, or Claude Code has not approved it yet (it asks once per project). `cw doctor` names the fix.
- The tool asks for a login or fails with an authentication error: tell the user that the one-time `/mcp` login fixes it.
- In both cases ask the user to paste the ticket text (title, description, acceptance criteria), or to confirm that the command's notes are the whole requirement.

## The snapshot for `cw ticket save`

`cw ticket save --task <id>` takes one JSON object on stdin (`schemas/ticket.schema.json`):

| Field | From the issue | Notes |
|---|---|---|
| `key` | `id` | must be the task's ticket |
| `summary` | `title` | required |
| `description` | `description` | Markdown, as returned |
| `acceptanceCriteria` | the criteria confirmed in O2 | a list of strings |
| `status` | `status` | |
| `assignee` | `assignee` | `null` when unassigned |
| `url` | `url` | https; required when `source` is `linear` |
| `context` | the context file `cw ticket context` named | only when it exists and you read it |
| `source` | `"linear"` | `"pasted"` for a pasted ticket, `"notes"` for NO-TICKET (O3) |

## The task type

Linear has no issue type like Jira's: a ticket whose `labels` name `Bug` is `bugfix`, everything else `feature`. `hotfix` only when the user asks for one.
