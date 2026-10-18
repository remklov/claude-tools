---
name: fisko-frontend
role: implementer
description: fisko-app conventions (Spanish copy, API clients, no dev server).
when:
  areas: [frontend]
rules: [FISKO-UI-COPY, FISKO-UI-DATA, TW-DESIGN-SYSTEM]
---
1. Follow `fisko-app/AGENTS.md` and the design system in `DESIGN.md`; user-facing copy is Spanish.
2. Talk to the backend only through the clients in `src/lib/`; never call the signer.
3. Test pure logic (form rules, payload builders, formatting) directly with Vitest; never call a real server.
4. Never start a dev server (port 5174 is the owner's, 5176 is off limits): verify with tests and typecheck and list what only a browser can confirm as `manual` open points.
