# ADR 001: One plugin with stack packs as data

Status: accepted (2026-10-18)

Stack knowledge (rules, procedures, scripts, guards) ships as data packs inside the `dev-workflow` plugin (`packs/<id>/`), and projects can add local packs in the same format under `.claude/workflow/packs/`.

Why: plugins cannot ship `.claude/rules`, so `cw` needs a reliable path to every pack to compile rules; packs as real skills would fill every session's skill list and could trigger in the wrong stack; new projects need only two plugin entries.
