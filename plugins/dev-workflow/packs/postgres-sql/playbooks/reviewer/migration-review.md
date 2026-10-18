---
name: migration-review
role: reviewer
description: Review new migrations for rollback safety and numbering.
when:
  paths: ["{options.dir}/**"]
scripts: [postgres-sql:migration-check]
---
1. For every new file in `{options.dir}`: `cw run postgres-sql:migration-check --file <file> --base <base commit>`.
2. Answer the three self-check questions yourself from the SQL and the code; don't copy the implementer's answers.
3. A colliding number, an incompatible change or a missing self-check is a blocking finding (rule SQL-MIGRATION-COMPAT or SQL-MIGRATION-NUMBERING, category `migration`).
