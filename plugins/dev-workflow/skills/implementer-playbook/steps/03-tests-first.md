# 3 Tests first

1. Write or extend tests for every acceptance criterion, following the rules for test files (behaviour, not internals; deterministic; no focused or skipped tests).
2. A bug fix gets a regression test that fails on the unfixed code.
3. Stub external systems at their client boundary; never call real services or shared databases other than the isolated test database.
4. `cw step --task <id> --done 3`.
