---
pack: postgres-sql
---

## SQL-MIGRATION-COMPAT — Backwards-compatible migrations
<!-- rule: severity=blocking; scope=paths:{options.dir}/**; protected=true -->
Every migration leaves the schema in a state the previous deployed application version can still read and write without errors (rollback safety).

- Always safe: a new table; an index; a nullable column; a column with a default.
- Two phases, never in one deployment: dropping a column (first remove all code references and deploy, then drop); renaming a column or table (add the new name, move the code, deploy, then drop the old name).
- Never directly: an `ALTER COLUMN … TYPE` incompatible with existing data or queries (add a new column, backfill, cut over, drop later); `NOT NULL` on an existing column without a default or prior backfill.

Answer the self-check in the report: (1) can the previous version `SELECT` from all affected tables? (2) can it `INSERT` without the new columns? (3) is anything dropped that current code still references? `cw run postgres-sql:migration-check --file <file>` lists the risky statements.

## SQL-NO-SCHEMA-PUSH — No schema push
<!-- rule: severity=blocking; scope=all; protected=true -->
Schema changes go through migration files in `{options.dir}` only; never push a schema directly to a database (`drizzle-kit push` and similar).

## SQL-PARAMS — Bound parameters
<!-- rule: severity=blocking; scope=areas:backend,data; protected=true -->
Queries use the query builder or tagged templates with bound parameters; never build SQL from input by concatenation or template literals.

## SQL-TEST-DATABASE — Isolated test database
<!-- rule: severity=blocking; scope=areas:backend,data -->
Database tests run only against the isolated test database; never against a development or production database.
