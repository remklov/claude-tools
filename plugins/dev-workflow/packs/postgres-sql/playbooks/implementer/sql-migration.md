---
name: sql-migration
role: implementer
description: Write a backward-compatible, numbered SQL migration.
when:
  paths: ["{options.dir}/**"]
  keywords: [migration, schema, column, index, table]
scripts: [postgres-sql:next-number, postgres-sql:migration-check]
rules: [SQL-MIGRATION-COMPAT, SQL-MIGRATION-NUMBERING]
---
1. Name the file with `cw run postgres-sql:next-number --slug <words_with_underscores> --task <id>`.
2. Write only changes the previous deployed version can still read and write (SQL-MIGRATION-COMPAT); split drops and renames into two tasks.
3. `cw run postgres-sql:migration-check --file <file> --task <id>`; paste its self-check with your answers into the report's `migrations` field.
4. Tests run against the isolated test database only; never apply the migration to a development database — the orchestrator asks the owner.
