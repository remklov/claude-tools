---
pack: react-vite
---

## REACT-A11Y — Accessibility
<!-- rule: severity=blocking; scope=areas:frontend -->
Use semantic elements: actions are `<button>`, navigation is `<a>` or the router's link. Every form control has an associated `<label>` or `aria-label` (a placeholder is not a label). Meaningful images have descriptive `alt` text; decorative ones have `alt=""`.

## REACT-FETCH-OK — Check `response.ok`
<!-- rule: severity=blocking; scope=areas:frontend -->
`fetch` resolves on 4xx and 5xx, so check `response.ok` (or use the project's API client that does) before reading the body, and treat a non-ok response as an error that the UI shows.

## REACT-EFFECT-CLEANUP — Effects that fetch
<!-- rule: severity=blocking; scope=areas:frontend -->
An effect that fetches has a cleanup that aborts (`AbortController`) or sets an ignore flag, and sets no state after that (check `signal.aborted` in `catch`). It shows non-ok responses and rejections as an error state.

## VITE-ENV-SECRETS — No secrets in the client bundle
<!-- rule: severity=blocking; scope=areas:frontend; protected=true -->
Never put secrets in `VITE_`-prefixed variables or `import.meta.env`; Vite inlines them into the client bundle.

## RTL-QUERIES — Query by role, label or text
<!-- rule: severity=blocking; scope=areas:frontend -->
UI tests query by role, label or text; use test IDs only when none of those exist.

## RTL-CLEANUP — Testing Library cleanup
<!-- rule: severity=blocking; scope=areas:frontend; when=option:vitestGlobals=false -->
Every web test file calls `cleanup()` in `afterEach`. With Vitest globals off, Testing Library doesn't clean up on its own.
