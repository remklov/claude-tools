# O8 Review loop

1. `cw git foreign-commits --task <id>`. Foreign commits → send the printed rebase instruction to the SAME implementer via SendMessage and wait for a new report.
2. `cw task review --task <id>` (needs a valid done report). First round: call the Agent tool with the printed `agent`, `description`, `prompt`, then `cw task agent --task <id> --role reviewer --id <agentId>`. Later rounds: it prints a `sendMessageTo` + `message` for the SAME reviewer, which keeps its traces and checks only what changed.
3. The review's `status`:
   - **approved** → O9.
   - **changes_requested** → `cw task return --task <id>`; send the printed message to the SAME implementer via SendMessage (it contains the blocking findings and cheap ones marked "also"), then back to step 1 for the next round. At the last round `cw task return` reports `escalated`: show the user the findings and let them decide (continue with `cw task phase --task <id> implement --note "<decision>"`, or `cw task end --outcome aborted`).
4. A spec change the user asks for after an approval starts a new review cycle: update the spec, send it to the implementer, and review again; tell the user the round count restarts.
