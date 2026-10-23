# Local tickets

With `tickets.source` local every ticket is a Markdown file in the project: `tickets.contextPath` with the key in place of `{key}`, for example `docs/specs/APP-42.md`. `cw ticket context --ticket <KEY>` names the file and refuses a key without one (exit 3).

## Reading it

Read the file once with the Read tool, in O1. It is the whole ticket: the requirement and its technical details. Never edit it (ground rule 1); a change the ticket needs is the user's to make.

## The snapshot for `cw ticket save`

`cw ticket save --task <id>` takes one JSON object on stdin (`schemas/ticket.schema.json`):

| Field | From the file | Notes |
|---|---|---|
| `key` | the key | must be the task's ticket |
| `summary` | the first heading, without the `#` | required; a file without a heading: one line that names the change |
| `description` | the text below the heading | Markdown, as written |
| `acceptanceCriteria` | the criteria confirmed in O2 | a list of strings |
| `status` | a status the file states | leave it out otherwise |
| `path` | the file as `cw ticket context` printed it | required |
| `source` | `"local"` | `"notes"` for NO-TICKET (O3) |

A local snapshot has no `url` unless the file names the ticket's web address, and no `context`: the file is the ticket.

## The task type

`bugfix` when the file describes a defect, everything else `feature`. `hotfix` only when the user asks for one.
