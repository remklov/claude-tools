# O3 Spec

Goal: the task exists, the ticket snapshot is saved, and the spec passes `cw spec lint`.

## 1. Create the task

```bash
cw task new --ticket <KEY> --slug <slug> --title "<short title>" --type feature
```

- `--ticket`: the ticket key, or `NO-TICKET`.
- `--slug`: 2–4 lowercase words joined by hyphens that name the change (`cart-empty-state`). The git preset builds the branch from ticket, type and slug.
- `--title`: a short title in the repository language; it heads the spec and the agents' descriptions.
- `--type`: `feature` by default; `bugfix` for a defect (the source's reference file says how a ticket shows one); `hotfix` only when the user says so. A bug fix needs a regression proof later.
- A warning that the branch exists already: ask the user whose branch it is before the task starts.

The output names the task id, the branch and the spec file with its template. From now on Edit and Write are refused in this session.

## 2. Save the ticket snapshot

Write the snapshot as JSON (the fields per source in its reference file, O1), including the acceptance criteria confirmed in O2, with the Write tool to a new file in your scratchpad directory (ground rule 1):

```json
{"key": "APP-42", "summary": "…", "description": "…", "acceptanceCriteria": ["…"], "status": "…", "assignee": "…", "url": "https://…", "source": "jira"}
```

Then pass it on stdin:

```bash
cw ticket save --task <id> < <scratchpad>/<id>-ticket-1.json
```

A refusal names the field to correct; write the corrected JSON to a new file and save again.

- A pasted ticket: `source: "pasted"`, the key the user named, and the URL only if the user gave it.
- NO-TICKET: `key: "NO-TICKET"`, a one-line `summary` from the notes, the notes as `description`, `source: "notes"`; leave out `url`, `status` and `assignee` (`status` is a string when present, never `null`).
- Never put secrets or personal data beyond the assignee's name into the snapshot.

## 3. Write the spec

Start from the template that `cw spec show --task <id>` prints, keep its title and header line as they are, and fill every section by the rules of `cw playbook read reference/spec.md`. Write it with the Write tool to a new file in your scratchpad directory, then save it:

```bash
cw spec save --task <id> < <scratchpad>/<id>-spec-1.md
```

## 4. Lint until clean

Run `cw spec lint --task <id>`. Errors block classification and the implementer's start: fix each one, save the whole spec again, and lint again. Treat warnings as questions: a vague criterion gets sharper wording; a path that does not exist yet is fine for a new file.

Before you go on, read the spec once as the implementer will: every requirement has at least one acceptance criterion, every criterion is testable, and nothing in it contradicts the ticket or the user's answers.

Done when: `cw spec lint` reports a clean spec. Continue with O4.
