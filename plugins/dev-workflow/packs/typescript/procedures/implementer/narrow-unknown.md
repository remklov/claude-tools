---
name: narrow-unknown
role: implementer
description: Validate untyped input (request bodies, JSON, external responses) instead of casting it.
when:
  keywords: [body, payload, json, parse, response, input, webhook, import]
rules: [TS-NO-ANY, TS-NO-CAST]
---
1. Type the raw value as `unknown`.
2. If the package already depends on a schema library (zod, valibot, ajv), define a schema and parse; otherwise write a type guard.
3. Answer invalid input with the documented error (HTTP 4xx, error state, rejected promise); never continue with a cast.
4. Test the valid case and at least one invalid shape with real objects (no casts in tests).
