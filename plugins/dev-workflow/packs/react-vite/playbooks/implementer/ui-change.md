---
name: ui-change
role: implementer
description: Change or add UI: components, states, tests, and how to verify without a browser.
when:
  areas: [frontend]
rules: [REACT-A11Y, REACT-FETCH-OK, REACT-EFFECT-CLEANUP, RTL-QUERIES]
---
1. Read the package docs named in your brief (design system, conventions) before writing markup.
2. Function components with named exports; keep a component and its test side by side.
3. Reuse existing components and tokens; never invent visual design the spec does not settle — report `blocked` with the question instead.
4. Talk to the backend only through the project's API client.
5. Test behaviour with Testing Library (role, label, text queries); stub the API client, never a real server.
6. If the project forbids dev servers (guard), verify with tests and typecheck and list every check only a browser can confirm as an open point with tag `manual`.
