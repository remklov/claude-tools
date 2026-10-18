# Report format (stdin of `cw report save`)

```json
{
  "status": "done",
  "acceptanceCriteria": [{ "id": "AC1", "met": true, "evidence": "fisko-api/src/x.test.ts › writes the IVA of the subject amount" }],
  "migrations": "none",
  "docs": ["docs/FEATURES.md"],
  "openPoints": [{ "text": "Confirm in the provider's test environment", "tag": "manual" }]
}
```

- `status`: `done` | `blocked` | `misclassified`.
- `blocked`: add `"blocked": { "question": "…", "needed": "…" }`.
- `misclassified`: add `"misclassified": { "reason": "…", "suggested": { "complexity": "l" }, "branchCreated": true, "dirty": false }`; make no commits.
- `migrations`: "none", or the migration files with the self-check answers and deploy steps.
- `openPoints[].tag`: `manual` (only a browser, device or live system can verify), `follow-up`, `risk`, `question`.
- Evidence names the test (file › test name) or the code that proves the criterion.
