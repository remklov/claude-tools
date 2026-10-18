# ADR 003: Generalist roles with tiers instead of type agents

Status: accepted (2026-10-18)

Agents are `orchestrator`, `implementer-{s,m,l,xl}`, `reviewer`, `investigator`. Domain knowledge (frontend, backend, infra) comes from packs and project procedures selected by the task's areas. No Fable models are used; the investigator runs on Opus 5.5 with `xhigh` effort.

Why: type × size gave twelve agents with the stack baked into prompts; full-stack tasks were split by force; a wrong type meant a restart.
