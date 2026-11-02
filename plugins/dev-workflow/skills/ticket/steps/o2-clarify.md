# O2 Clarify

Goal: requirements and acceptance criteria that an implementer can test and a reviewer can check, without guessing.

## What needs an answer

Ask only what the ticket, the notes, the plan file and the code cannot answer:

- the expected behaviour where the ticket is vague ("should work", "as before", "properly");
- edge cases and error behaviour the change must handle;
- the acceptance criteria, if the ticket has none: S10 requests no acceptance-criteria field, so take them from the description or the plan file and confirm them here;
- scope: what is explicitly not part of the task (the non-goals);
- conflicts between the ticket, its comments, the plan file and the code, and requirements or criteria that contradict each other when read literally (two criteria that both decide the same input differently, or leave it open);
- the operational fallout: configuration and environment variables per environment (production included), migrations, caches and reindexing, deploy order, feature flags and manual steps. What the ticket leaves open here, ask; the answers go into the spec's Risks and deploy steps;
- anything that would need a new dependency, a schema or API contract change, or a change outside the packages: the user decides it before the spec says so. A library named in the ticket or the notes is not yet an approved dependency: ask explicitly whether to add it to which package, and say that the user then installs it in the work tree when the implementer reports `blocked` (agents may not install, O7). Without that approval the spec does without it.

Do not ask what you can read in the code, and do not ask for confirmation of things the ticket states clearly.

## How to ask

- AskUserQuestion, at most `workflow.maxQuestionsPerRound` questions per round (`cw config show`; default 4). Never a question in text: it would end the turn that runs at high effort (ground rule 10).
- Each question offers concrete options, your recommended one first, so the user can answer with one click.
- Several rounds are fine; stop as soon as every acceptance criterion is testable.
- Note every answer: it goes into the spec (O3) as a requirement, an acceptance criterion, a non-goal or context.

## Testable means

- Each acceptance criterion names an observable result: a response, a rendered state, a stored value, a log line, an error, with the input that leads to it.
- A bug fix has a criterion for the fixed behaviour; the regression test that fails on the unfixed code covers it.
- A check only a person can do (a visual detail in a browser) is never an acceptance criterion. If the user wants it, it goes into the spec's Definition of done as a manual check; it needs no test, and the implementer lists it as an open point with tag `manual`. Tell the user so.

Done when: you could write every acceptance criterion as a test. Continue with O3.
