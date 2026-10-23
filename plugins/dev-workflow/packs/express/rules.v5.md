## EXPRESS-ASYNC-ERRORS — Async handlers forward their errors
<!-- rule: severity=blocking; scope=areas:backend -->
Async route handlers throw or reject instead of calling `next(err)` by hand; Express 5 forwards rejected promises to the error middleware. `{options.appEntry}` registers a JSON 404 handler and one error handler with exactly 4 parameters `(err, _req, res, _next)` last; Express only treats 4-parameter middleware as an error handler.

## EXPRESS-RESPONSE-FLOW — Response flow and Express 5 syntax
<!-- rule: severity=blocking; scope=areas:backend -->
Wildcards are named (`'/*splat'`, not `'*'`), optional segments use braces (`'/items{/:id}'`), `req.query` is read-only, and `req.body` is `undefined` when no body parser matched. Write `return res.status(…).json(…)` so nothing runs after the response is sent.
