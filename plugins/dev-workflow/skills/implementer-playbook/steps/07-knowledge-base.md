# 7 Knowledge base

1. Do the duties your brief lists (feature register, lessons for non-trivial bug fixes, new open to-dos with IDs from `cw ticket reserve-id <PREFIX>`, docs your change makes wrong).
2. When the ticket is fully done and the brief says so, delete its backlog row: `cw ticket done <ID>`.
3. `cw kb check --task <id>` lists what still looks missing; fix it or explain in the report why it doesn't apply.
