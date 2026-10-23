## CORE-SCOPE — Scope
<!-- rule: severity=blocking; scope=all -->
Change only what the task needs. No drive-by refactors, renames or reformatting of untouched code; report those as open points. Remove what your change made unused, including exports nothing imports anymore.

## CORE-SIMPLICITY — Simplicity
<!-- rule: severity=blocking; scope=all -->
Don't add parameters, options, generics, interfaces or config that no current caller uses. Don't extract a helper for code with fewer than three call sites.

## CORE-NAMING — Naming
<!-- rule: severity=blocking; scope=all -->
Descriptive names in the repository language (`{project.language.repo}`). Allowed abbreviations: {options.abbreviations}, and `i`/`j` as loop indices. Booleans you declare start with `is`, `has`, `can` or `should`.

## CORE-STRUCTURE — Structure
<!-- rule: severity=blocking; scope=all -->
Handle invalid input and edge cases first with an early return. No `if` or loop nesting deeper than 2 levels inside one function.

## CORE-COMMENTS — Comments
<!-- rule: severity=blocking; scope=all -->
Comments explain why, not what. No commented-out code. A TODO carries a ticket key: `{options.todoFormat}`. Without a ticket, list it as an open point instead of writing a TODO.

## CORE-ERRORS — No swallowed errors
<!-- rule: severity=blocking; scope=all -->
Every `catch` (or `except`, `rescue`) handles the error with a visible outcome (error state, log, response) or rethrows it. No empty catch blocks. Fire-and-forget work logs its failure.

## CORE-TEST-SPEC — Coverage of the spec
<!-- rule: severity=blocking; scope=all -->
Every acceptance criterion has at least one test. A bug fix includes a regression test, and the report shows it failing on the unfixed code (command and failure line, `cw prove`). Every test must fail when the behaviour it covers is removed; an assertion that holds either way doesn't count as coverage.

## CORE-TEST-BEHAVIOUR — Test behaviour, not internals
<!-- rule: severity=blocking; scope=all -->
Test through public interfaces (HTTP, the UI, exported functions). Pure functions may be unit-tested directly. Don't mock this repository's own modules; stub external systems at their client boundary.

## CORE-TEST-DETERMINISTIC — Deterministic, isolated tests
<!-- rule: severity=blocking; scope=all -->
No requests leave the test process. No sleeps or fixed waits; use fake timers or waiting queries. Restore stubs, mocks and timers after each test. Tests never touch development or production data stores.

## CORE-TEST-HONEST — Keep tests honest
<!-- rule: severity=blocking; scope=all -->
Don't delete, skip, focus or loosen existing tests. Change an existing assertion only when the spec changes that behaviour, and name each such test in the report.

## CORE-DEPENDENCIES — Dependencies
<!-- rule: severity=blocking; scope=all -->
Don't add, remove or change dependencies in package manifests or lockfiles (for example `package.json` and `package-lock.json`). If a task needs one, stop and report it (status `blocked`).

## CORE-REPRODUCIBLE-BUILDS — Reproducible builds
<!-- rule: severity=blocking; scope=paths:**/Dockerfile*|**/*compose*.y*ml|.github/workflows/**|**/.gitlab-ci.yml -->
Container and CI images use a full version tag or a digest (for example `node:22.13.1-alpine`). No `latest` and no major-only tags.

## CORE-LANGUAGE — Language
<!-- rule: severity=blocking; scope=all -->
Everything in the repository is written in the repository language (`{project.language.repo}`): code, comments, identifiers, commits, log and error strings, developer docs and dev-tooling UI. User-facing product copy (UI labels, translation files, editorial content) follows the product language (`{project.language.productCopy}`). Don't mix languages within a file; report an existing mix as an open point.

## CORE-SECRETS — Secrets
<!-- rule: severity=blocking; scope=all; protected=true -->
Never commit secrets, credentials, certificates or private keys; configuration comes from environment variables, CI variables or a secret manager.

## CORE-INJECTION — Injection
<!-- rule: severity=blocking; scope=all; protected=true -->
Never build HTML, shell commands or queries from input by concatenation or string templates; use the platform's escaping, argument arrays and bound parameters.

## CORE-LOGGING — Logging
<!-- rule: severity=blocking; scope=all; protected=true -->
Never log tokens, passwords, `Authorization` or `Cookie` headers, request bodies, or personal data such as names, e-mails or addresses.
