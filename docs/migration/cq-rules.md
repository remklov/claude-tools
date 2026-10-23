# Migrating a CQ rule set: an example map

How a project's own code-quality rules move into the packs, shown for the example project Acme Shop (the reference layout of `docs/PLAN.md` R5: an outer repository with the application in `app/`). A real project follows the same steps with its own numbering; fisko's CQ-1…28, for example, need a map of their own.

Acme Shop's `.claude/rules/code-quality.md` defines the rules CQ-1 to CQ-23. With dev-workflow they come from the rule packs instead (`docs/PLAN.md` §7). This page maps every old rule to its successors, maps the conventions from Acme Shop's `CLAUDE.md`, and lists what the project layer has to add in the migration (P6, Appendix C of the plan).

`plugins/dev-workflow/tests/unit/migration-map.test.mjs` reads the first table and checks that CQ-1 to CQ-23 each appear once and that every successor is an active rule for the Acme Shop pack set below.

## Code-quality rules

| Old rule | Successor |
|---|---|
| CQ-1 | CORE-SCOPE |
| CQ-2 | CORE-SIMPLICITY |
| CQ-3 | CORE-NAMING |
| CQ-4 | CORE-STRUCTURE |
| CQ-5 | CORE-COMMENTS |
| CQ-6 | CORE-DEPENDENCIES + NPM-WORKSPACE-IMPORTS |
| CQ-7 | TS-NO-ANY + EXPRESS-INPUT-VALIDATION |
| CQ-8 | TS-NO-CAST |
| CQ-9 | CORE-ERRORS |
| CQ-10 | EXPRESS-ASYNC-ERRORS + EXPRESS-ERROR-RESPONSES |
| CQ-11 | EXPRESS-RESPONSE-FLOW |
| CQ-12 | CORE-TEST-SPEC |
| CQ-13 | CORE-TEST-BEHAVIOUR + EXPRESS-SUPERTEST + RTL-QUERIES |
| CQ-14 | CORE-TEST-DETERMINISTIC + VITEST-TIMERS |
| CQ-15 | RTL-CLEANUP |
| CQ-16 | CORE-TEST-HONEST + VITEST-NO-FOCUS |
| CQ-17 | REACT-A11Y |
| CQ-18 | REACT-FETCH-OK |
| CQ-19 | REACT-EFFECT-CLEANUP |
| CQ-20 | CORE-SECRETS + VITE-ENV-SECRETS |
| CQ-21 | CORE-INJECTION + REACT-NO-RAW-HTML |
| CQ-22 | CORE-LOGGING |
| CQ-23 | CORE-REPRODUCIBLE-BUILDS + NPM-CI |

The security rules CQ-20 to CQ-22 were the ones a spec could not override. Their successors CORE-SECRETS, CORE-INJECTION, CORE-LOGGING, VITE-ENV-SECRETS and REACT-NO-RAW-HTML are protected rules, with the same effect.

Two parts of the old texts are project-specific and are not in a pack:

- CQ-10: "a 5xx response says `Internal Server Error`". It becomes a `rules.extend` entry for EXPRESS-ERROR-RESPONSES (below).
- CQ-5 named an example ticket key; the core option `todoFormat` (default `TODO(<TICKET-KEY>): …`) replaces it.

## CLAUDE.md conventions

| Convention | Successor |
|---|---|
| Express app built in `createApp()`, tested with supertest without a listening port | EXPRESS-SUPERTEST (express option `appEntry: "createApp()"`) |
| Relative imports with the `.js` extension (NodeNext) | TS-ESM-IMPORTS, active with the typescript option `moduleResolution: "nodenext"` |
| Language: English in the repo, product copy in the product language | CORE-LANGUAGE (`project.language.repo` and `productCopy`) |
| Frontend: function components, named exports, tests next to the component | A project rule (below) |

## Project layer for P6

The pack set the migration test builds, plus the project additions. The package layout is a placeholder.

```json
{
  "project": { "name": "Acme Shop", "language": { "repo": "en", "productCopy": "de" } },
  "workspace": { "mode": "in-place", "appRoot": "app" },
  "packs": [
    "node-npm",
    { "id": "typescript", "options": { "moduleResolution": "nodenext" } },
    { "id": "express", "variant": "5", "options": { "appEntry": "createApp()" } },
    { "id": "react-vite", "variant": "react-19", "options": { "vitestGlobals": false } },
    "vitest"
  ],
  "git": { "preset": "default", "noTicketKey": "NO-TICKET" },
  "tickets": { "source": "linear", "contextPath": "docs/specs/{key}.md" },
  "rules": {
    "extend": { "EXPRESS-ERROR-RESPONSES": "A 5xx response says `Internal Server Error`." }
  }
}
```

The tickets live in Linear (ADR 0009); `docs/specs/<KEY>.md` in the outer repository holds the technical requirements and implementation details of a ticket, which the orchestrator reads with it. The outer repository commits a `.mcp.json` with Linear's read-only server, which `claude mcp add --transport http --scope project linear https://mcp.linear.app/mcp/readonly` writes; each developer approves it once and logs in with `/mcp`.

The frontend component style goes into `.claude/dev-workflow/rules/frontend.md`, with a project prefix:

```markdown
## APP-COMPONENTS — Component style
<!-- rule: severity=blocking; scope=areas:frontend -->
Function components with named exports. A component's test sits next to it (`*.test.tsx`) and uses Testing Library.
```

To confirm in P6:

- `moduleResolution`: `CLAUDE.md` says NodeNext "to be confirmed against the customer repo's tsconfig". The typescript option is project-wide, so with `nodenext` TS-ESM-IMPORTS also applies to the frontend's `.ts` files. If the frontend resolves modules through Vite (`bundler`), narrow the rule with a `rules.override` file whose scope names the backend package path.
- `vitestGlobals`: `false` matches today's CQ-15 ("Vitest globals are off").
