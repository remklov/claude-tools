# R9 Verdict

1. Build the review JSON and pipe it into `cw review save --task <id>`:

```json
{
  "status": "changes_requested",
  "checks": [{ "package": "api", "check": "test", "command": "npm test", "result": "pass" }],
  "acceptanceCriteria": [{ "id": "AC1", "met": true, "evidence": "…" }],
  "rulesChecked": ["CORE-SCOPE", "TS-NO-CAST"],
  "findings": [{ "id": "F1", "severity": "blocking", "rule": "TS-NO-CAST", "file": "src/x.ts", "line": 12, "issue": "…", "suggestion": "…" }]
}
```

2. `status` is `approved` only with no blocking finding, all checks passing, all criteria met and every mutation killed. `cw` adds the mutations and validates.
3. Mark a non-blocking finding `"sendAlong": true` when it is cheap (a few lines in files the change already touches) or corrects something on the record (a test gap, a wrong sentence in the docs).
4. Your final message is exactly the JSON block `cw review save` printed.
