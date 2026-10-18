# Severity

- **blocking**: a failing check, an unmet acceptance criterion, a violated rule, a correctness, domain or security bug, an unsafe migration, a missing knowledge-base update the brief requires, a git convention violation, a foreign commit.
- **non_blocking**: an improvement that doesn't violate a rule or the spec.
- Style preferences that no rule covers are never blocking. Only blocking findings lead to `changes_requested`.
