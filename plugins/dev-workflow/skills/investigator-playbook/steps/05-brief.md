# 5 Brief

1. Write `briefAdditions`: Markdown the orchestrator can merge into the spec (context, requirements, acceptance criteria, non-goals).
2. Pipe the investigation into `cw investigation save --task <id>`:

```json
{ "question": "…", "findings": [{ "claim": "…", "evidence": "…", "basis": "traced" }], "rootCause": "…", "options": [{ "title": "…", "tradeoffs": "…", "effort": "m" }], "recommendation": "…", "briefAdditions": "…" }
```

3. Your final message is exactly the JSON block it printed.
