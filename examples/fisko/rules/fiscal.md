---
pack: project
---

## FISKO-DGII-SHAPES — Real DGII shapes
<!-- rule: severity=blocking; scope=areas:backend; protected=true -->
A test that builds or parses a DTE validates it against the official schema in `fisko-api/src/schemas/dgii/` (or goes through a code path that does). Fixtures based on real MH or supplier documents keep the real field set.

## FISKO-DTE-JSON — DTE JSON
<!-- rule: severity=blocking; scope=areas:backend; protected=true -->
Nullable fields are emitted as explicit `null`, never omitted. Builder `*_VERSION` constants match the schema `version` in `src/schemas/dgii/`. A new DTE type is registered as `fisko-api/AGENTS.md` describes.

## FISKO-MH-LIFECYCLE — DGII lifecycle
<!-- rule: severity=blocking; scope=areas:backend; protected=true -->
Actions towards MH (transmit, invalidate, contingency) change local `estado` only on MH's acceptance; unknown outcomes are settled by asking MH, never by guessing.

## FISKO-ACCESS — Access
<!-- rule: severity=blocking; scope=areas:backend; protected=true -->
A new user-facing endpoint has a `membership_features` key and `requireFeature(...)`; a route that issues, invalidates or imports adds `requireActiveBusiness()`; accountant writes go through a named grant permission (ADR 017). Fiscal records a business must keep are never deleted (`deletionBlockers()`).

## FISKO-SIGNER — Signer
<!-- rule: severity=blocking; scope=all; protected=true -->
The signer is called only through `fisko-api/src/modules/signer-client/`; frontends never call it. Signer code keeps zero persistence and wipes secret buffers after use.
