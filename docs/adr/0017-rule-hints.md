# 0017 `cw checks` prints rule hints from the diff

- Status: accepted, 2026-11-01 (fisko, 15 tasks of 2026-10-25 to 2026-11-01)

## Context

With the rules check of [ADR 0013](0013-implementer-rules-check.md), 7 of 14 tasks were approved in review round 1, against 3 of 7 before. Every implementer listed 33–48 checked rules. Three tasks still went back only for rule findings that a pattern finds:

- **BILL-14, CORE-SCOPE:** one untouched line with changed whitespace. Round 2 cost 4.3 M cache reads (16 % of the task).
- **BILL-23, CORE-NAMING:** `tx`, Drizzle's name for a transaction, which fisko's list of allowed abbreviations lacks. Round 2 cost 3.3 M (31 %).
- **BILL-12, CORE-NAMING and CORE-SIMPLICITY:** the booleans `billingLaunchPending` and `billingEnabled` without a prefix, and a helper with two call sites. Round 2 cost 4.0 M (28 %).

Reading the rules does not find every such line; a scan of the added lines does.

## Decision

`cw checks --task <id>` prints rule hints after the results, for the rules that apply to the task. `--json` carries them as `hints`.

- **CORE-SCOPE:** a hunk whose removed and added lines differ only in whitespace.
- **CORE-NAMING:**
  - A name the added lines declare (a variable, function, class, parameter or catch binding) with a single letter other than `i` and `j`, a known short form, or a word without vowels, unless the allowed list of the core pack has it. Common acronyms (`html`, `sql`, …) pass.
  - A declared boolean (typed `boolean`, or assigned `true`, `false`, a negation, `Boolean()` or a comparison) without `is`, `has`, `can` or `should`.
- **CORE-SIMPLICITY:** a new module-private function with fewer than three references in its file.

The names and helpers are scanned in JavaScript and TypeScript files (also `.vue` and `.svelte`), whitespace in every text file. Untracked files count as wholly added.

A hint is no finding. The implementer checks each one against its rule (step 5); the reviewer takes them as input for R4 and still checks every rule itself. A hint never fails `cw checks`, and an error in the scan skips the hints with a warning.

## Evidence

- **Sources.** The review files and the transcripts of fisko, 2026-10-25 to 2026-11-01.
- **Round cost.** Measured as in ADR 0013.
- **Expected effect.** The scan finds the patterns of all three returns; together they cost 11.6 M cache reads and about 25 minutes.

## Consequences

- Hints have false positives: a short parameter in a callback, or a name the project accepts. The implementer leaves those, and a project adds its words to the allowed list (`packs[core].options.abbreviations`).
- The measure stays the share of tasks approved in round 1.
