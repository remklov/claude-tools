---
pack: express
variant: "4"
---

## EXPRESS-ASYNC-ERRORS — Async handlers forward their errors
<!-- rule: severity=blocking; scope=areas:backend -->
Express 4 does not forward rejected promises. An async route handler wraps its body in `try`/`catch` and answers the error itself or passes it to {options.errorMiddleware} with `next(err)`.

## EXPRESS-RESPONSE-FLOW — Response flow
<!-- rule: severity=blocking; scope=areas:backend -->
Return right after sending a response (`res.status(…).json(…); return;` or `return res.status(…).json(…)`) so nothing runs after it.
