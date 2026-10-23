# Jira intake

With `tickets.source` jira the workflow reads each ticket once, in O1, through the Atlassian MCP server of the `atlassian` plugin (official marketplace), and never writes to it.

## The one call

Tool: `mcp__plugin_atlassian_atlassian__getJiraIssue`. If your tool list shows it as deferred, load its schema first (ToolSearch with `select:mcp__plugin_atlassian_atlassian__getJiraIssue`).

```json
{
  "cloudId": "<tickets.site from cw config show, e.g. your-company.atlassian.net>",
  "issueIdOrKey": "<KEY>",
  "fields": ["summary", "description", "status", "assignee", "issuetype"],
  "responseContentFormat": "markdown",
  "updateHistory": false
}
```

- The issue is `issues.nodes[0]`, with `key`, `fields.*` and `webUrl`.
- The site host works as `cloudId` (no discovery call). Only if it is refused, or `tickets.site` is not configured, call `mcp__plugin_atlassian_atlassian__getAccessibleAtlassianResources` once, take the `id` of the site, and repeat the issue call once with it.
- No other Jira calls: no search, no comments, no transitions, no edits.

## When Jira is not available

- The tool is missing: the `atlassian` plugin is not enabled (`cw doctor` warns about it). Tell the user how it is enabled (`claude plugin install atlassian@claude-plugins-official --scope project`; setup.sh explains it) and continue without it.
- The tool asks for a login or fails with an authentication error: tell the user that the one-time `/mcp` login fixes it.
- In both cases ask the user to paste the ticket text (summary, description, acceptance criteria), or to confirm that the command's notes are the whole requirement.

## The snapshot for `cw ticket save`

`cw ticket save --task <id>` takes one JSON object on stdin (`schemas/ticket.schema.json`):

| Field | From the issue | Notes |
|---|---|---|
| `key` | `key` | must be the task's ticket |
| `summary` | `fields.summary` | required |
| `description` | `fields.description` | Markdown, as returned |
| `acceptanceCriteria` | the criteria confirmed in O2 | a list of strings |
| `status` | the status name in `fields.status` | |
| `assignee` | the assignee's display name in `fields.assignee` | `null` when unassigned |
| `url` | `webUrl` | https; required when `source` is `jira` |
| `context` | the context file `cw ticket context` named | only when it exists and you read it |
| `source` | `"jira"` | `"pasted"` for a pasted ticket, `"notes"` for NO-TICKET (O3) |

## The task type

The issue type decides `--type` for `cw task new`: a Bug is `bugfix`, everything else `feature`. `hotfix` only when the user asks for one.

## The kickoff plan

`.claude/plans/<KEY>.md` (written by a planning skill or by hand, if the project uses one) holds an approach and an estimate. Read it as input: take its success criterion into the acceptance criteria if the user confirms it in O2, and check its claims about the code before the spec repeats them.
