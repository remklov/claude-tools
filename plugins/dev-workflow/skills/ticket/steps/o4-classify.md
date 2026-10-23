# O4 Classify

Goal: a recorded complexity (s, m, l or xl) that picks the implementer agent and its guardrails.

## 1. Let cw compute the facts

Run `cw classify --task <id>`. It reads the spec's paths and text and prints the packages, the areas, the minimum complexity from the project's escalation rules, and the reasons.

- Files the change will touch that the spec does not name: add them with `cw classify --task <id> --paths <file>,<file>` (paths relative to the work repo).
- "outside every package": the files belong to no configured package, so no checks would cover them. Ask the user whether the spec is wrong or the config needs a package; do not go on with unowned files.

## 2. Choose

Pick the level from the guardrails the implementer will get:

| Level | Fits when |
|---|---|
| s | 1–2 files, no change to existing behaviour or contracts |
| m | one module, additive and backward-compatible changes |
| l | contracts or schemas change, with every caller updated in the same change; migration or deploy steps |
| xl | the cause or the design is open and must be investigated first; security, concurrency or data-integrity implications |

- Between two levels, pick the higher one.

Record it with a one-sentence reason in the repository language:

```bash
cw classify --task <id> --set m --why "<one sentence: why this level>"
```

Never go below the minimum `cw` printed unless the user approved it (AskUserQuestion); then pass the user's reason:

```bash
cw classify --task <id> --set s --why "<one sentence>" --override "<the reason the user approved>"
```

## 3. Next

`cw` says what follows:

- the complexity is in `workflow.confirm` (default l and xl): O5;
- otherwise: O6 (`cw task start --task <id>`);
- after a misclassified report it names `cw task reset --task <id>` first (`cw playbook read reference/recovery.md`).

A spec change after this step (`cw spec save`) sends the task back to the spec phase: lint and classify again.
