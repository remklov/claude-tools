# O6 Delegate

1. Root cause unclear, or an xl design question → first `cw task investigate --task <id> --question "<question>"` and call the Agent tool with the `agent`, `description` and `prompt` it prints. Merge the investigation's `briefAdditions` into the spec, `cw spec lint` again, and reclassify if the picture changed.
2. `cw task start --task <id>` records the base (the main checkout's branch and HEAD, or the builds-on tip), renders the implementer brief and prints `{ agent, description, prompt }`.
3. Call the Agent tool with exactly `subagent_type: <agent>`, `description: <description>`, `prompt: <prompt>` — nothing else.
4. Right after the call returns, record the agent's ID: `cw task agent --task <id> --role implementer --id <agentId>` (you need it for SendMessage).
5. While the implementer works, prepare the review: read the spec's acceptance criteria and the reviewer procedures.
