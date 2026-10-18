# Complexity

| Complexity | Criteria | Agent |
|---|---|---|
| `s` | 1–2 files, no change to existing behaviour or contracts, obvious fix | implementer-s (Sonnet, low) |
| `m` | Several files within one module, new tests needed. Additive, backward-compatible changes such as a new endpoint or a new optional field | implementer-m (Sonnet, medium) |
| `l` | Changes an existing API contract or data schema, needs a migration, or spans several modules | implementer-l (Opus, medium) |
| `xl` | Architectural change, security-sensitive, concurrency, or unclear root cause | implementer-xl (Opus, high); unclear root cause → investigator first (Opus, xhigh) |

If a task sits between two levels, pick the higher one. The profile's escalation rules (`cw classify`) set a minimum; never go below it without the user's approval.
