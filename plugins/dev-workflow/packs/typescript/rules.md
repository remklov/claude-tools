## TS-NO-ANY — No `any`
<!-- rule: severity=blocking; scope=paths:**/*.{ts,tsx,mts,cts} -->
No `any`. Assign untyped input (`JSON.parse`, `response.json()`, request bodies, message payloads) to `unknown` and narrow it with a schema or a type guard before use.

## TS-NO-CAST — No casts or suppressions
<!-- rule: severity=blocking; scope=paths:**/*.{ts,tsx,mts,cts} -->
No `as` casts (except `as const`) and no non-null assertions (`!`) in new code. In tests, build real objects (for example `new Response(JSON.stringify(body), { status })`) instead of casting. If a suppression is unavoidable, use `// @ts-expect-error <reason>` or `// eslint-disable-next-line <rule> -- <reason>`.

## TS-ESM-IMPORTS — Relative imports with `.js`
<!-- rule: severity=blocking; scope=paths:**/*.{ts,mts}; when=option:moduleResolution=nodenext -->
With NodeNext module resolution, relative imports use the `.js` extension of the compiled file (`import { x } from './x.js'`).
