---
pack: postgres-sql
variant: numbered-sql
---

## SQL-MIGRATION-NUMBERING — Numbered migration files
<!-- rule: severity=blocking; scope=paths:{options.dir}/**; protected=true -->
Each new migration is the next free number in `{options.dir}` following `{options.pattern}` (`cw run postgres-sql:next-number --slug <slug>`). The number must still be free on the base branch when the change merges. Applied migrations are never edited.
