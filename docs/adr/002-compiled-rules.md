# ADR 002: Rules are compiled into the project

Status: accepted (2026-10-18)

`cw rules build` layers core, stack packs (with variants) and project customizations into `.claude/rules/workflow/*.md` with `paths` frontmatter and a lock file. The output is committed.

Why: native rule loading applies to every session, path scoping saves context, pack updates show up as reviewable diffs, and the reviewer queries exactly the same rulebook (`cw rules applicable`).
