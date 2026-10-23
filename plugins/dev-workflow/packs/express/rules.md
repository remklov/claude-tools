## EXPRESS-ERROR-RESPONSES — Error responses
<!-- rule: severity=blocking; scope=areas:backend -->
Invalid client input gets a 4xx status. Error responses use the API's shape `{options.errorShape}`. A 5xx response never exposes stack traces or internal details.

## EXPRESS-INPUT-VALIDATION — Validate request input
<!-- rule: severity=blocking; scope=areas:backend -->
Assign `req.body` to `unknown` and validate it before use. Validate the format of `req.params` and `req.query` values (for example a numeric id or a UUID) and answer invalid ones with 400.

## EXPRESS-SUPERTEST — Test routes over HTTP
<!-- rule: severity=blocking; scope=areas:backend -->
Test every new or changed route over HTTP with supertest against `{options.appEntry}`, including its error responses, without binding a fixed port.
