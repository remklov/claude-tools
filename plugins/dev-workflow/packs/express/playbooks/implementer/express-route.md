---
name: express-route
role: implementer
description: Add or change an Express route with validation, error responses and HTTP tests.
when:
  keywords: [route, endpoint, api, handler, middleware, request]
  areas: [backend]
rules: [EXPRESS-ASYNC-ERRORS, EXPRESS-ERROR-RESPONSES, EXPRESS-INPUT-VALIDATION, EXPRESS-SUPERTEST, EXPRESS-RESPONSE-FLOW]
---
1. Find where routes are registered for `{options.appEntry}` and follow the module's existing pattern.
2. Validate body, params and query first (early returns with 4xx in `{options.errorShape}`).
3. Handle async errors as EXPRESS-ASYNC-ERRORS says for this Express version.
4. Write supertest tests against `{options.appEntry}`: the success case per acceptance criterion and each error response.
5. Stub external systems at their client module; never call real services from tests.
