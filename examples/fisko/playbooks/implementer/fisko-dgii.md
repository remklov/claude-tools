---
name: fisko-dgii
role: implementer
description: Work on DTE, DGII/MH integration, tax classification and F-07/F14 code.
when:
  areas: [backend]
  keywords: [DTE, MH, DGII, F-07, F14, CRE, CCFE, NCE, NDE, FEX, IVA, Anexo]
rules: [FISKO-DGII-SHAPES, FISKO-DTE-JSON, FISKO-MH-LIFECYCLE]
---
1. Never guess on MH behaviour, tax rules or data structures: the sources are `plan/NORMATIVA_V2.md`, the schemas in `fisko-api/src/schemas/dgii/`, MH's manuals cited in the spec and `docs/LESSONS.md`. Missing source → report `blocked`.
2. Stub MH/DGII, the signer and AWS at their client boundary in tests.
3. A new DTE type is registered as `fisko-api/AGENTS.md` describes.
4. fisko-api tests use the isolated test database only; `cw checks` starts `fisko-test-db` and runs one test suite at a time.
