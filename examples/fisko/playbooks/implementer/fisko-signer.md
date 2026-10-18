---
name: fisko-signer
role: implementer
description: Changes in fisko-signer (always xl).
when:
  paths: ["fisko-signer/**"]
rules: [FISKO-SIGNER]
---
1. Run `cw checks --changed --task <id>`; the signer's test check is `npm run test:coverage`.
2. Zero persistence; wipe secret buffers after use; no new outbound calls.
3. Read the signer ADRs in `fisko-infra/docs/adr/` before changing behaviour.
