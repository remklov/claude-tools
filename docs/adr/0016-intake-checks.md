# 0016 The intake checks of a kickoff plan

- Status: accepted, 2026-11-01

## Context

A test of the workflow against a kickoff-plan skill found the spec less thorough. Production configuration, requirements of the ticket and contradicting acceptance criteria slipped through. Observation reported by a colleague; their tasks are not in these sources.

The kickoff skill does four things:

- It reads the ticket's comments and links, because scope agreed in a comment belongs to the requirement.
- It looks for earlier work on the key in every branch and in open merge requests.
- It turns the operational fallout (schema, migrations, caches, environment variables) into the merge request's risks.
- Its review compares the change with the ticket in both directions.

The workflow did none of this:

- The Jira reference allowed no comment calls.
- O1 looked only for an active task of the key.
- The spec had no section for the fallout.
- The reviewer checked against the spec, never against the ticket.

With delegation the spec is the only channel to the implementer and the reviewer, so a gap in it reaches nobody.

fisko's reviews show the same gaps:

- BILL-5: R2 did not account for the admin boundary.
- BILL-14: R3 and R5, read literally, allowed a defect, and a normative step of the plan was missing from R7.
- BILL-23: the spec rested on a premise the code did not hold.
- BILL-13: the spec left out the plan's re-evaluation after a changed revision.

## Decision

- **O1.**
  - The ticket read takes the comments and linked issues: for Jira, the fields `comment` and `issuelinks` of the one call; for Linear, a comments call where the server offers one. The snapshot keeps them (`comments`, `links`), and the briefs show them.
  - `cw ticket context` lists the branches and commits that name the key, and the orchestrator asks about such work before it plans anew.
- **O2** also asks about criteria that contradict each other when read literally, and about the operational fallout: configuration per environment (production included), migrations, caches, deploy order and manual steps.
- **O3.**
  - The spec template gets the section Risks and deploy steps (`None.` when there is none), and the PR/MR's Risks & deploy steps take it over. `cw spec lint` warns when it is missing and refuses its placeholder.
  - The read-through checks that no two criteria decide the same input differently, and that every requirement of the ticket and its comments is a requirement or a non-goal.
- **R3.** The reviewer compares the ticket in its brief with the spec and the diff in both directions. A gap or a contradiction is a `spec` finding for the user's decision ([ADR 0015](0015-user-decides-review-findings.md)).

## Evidence

- **Sources.** The review files of fisko (2026-10-25 to 2026-11-01) and the two skills of the comparison.
- **Jira fields.** `comment` and `issuelinks` are issue fields of the Jira Cloud REST API: Get issue, developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues.
- **Not yet observed through the Atlassian MCP server.** `reference/jira.md` therefore repeats the call without the two fields once if they are refused, and says so to the user.

## Consequences

- The intake reads more: the comments and the work on the key. The orchestrator asks more in O2, where a question is cheaper than a round later.
- A spec saved before the section existed still passes lint, with a warning.
- fisko's local ticket files have no comments; the other checks apply there too.
