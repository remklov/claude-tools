## VITEST-NO-FOCUS — No focused or skipped tests
<!-- rule: severity=blocking; scope=paths:**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs} -->
No `.only`, `.skip` or `.todo` in committed tests.

## VITEST-TIMERS — Fake timers instead of waits
<!-- rule: severity=blocking; scope=paths:**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs} -->
No `setTimeout`-based waits or sleeps in tests; use `vi.useFakeTimers()` or waiting queries, and restore real timers in `afterEach`.
