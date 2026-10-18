---
name: fisko-fiscal-review
role: reviewer
description: Check DTE, DGII and tax changes against the official sources.
when:
  areas: [backend]
  keywords: [DTE, MH, DGII, F-07, F14, CRE, CCFE, NCE, NDE, FEX, IVA, Anexo]
---
1. Compare the change with the sources the spec cites (`fisko-api/src/schemas/dgii/`, `plan/NORMATIVA_V2.md`, the F-07 research, MH's manuals) and with `docs/LESSONS.md`.
2. A deviation from MH's schema or rules is a blocking finding with category `domain`.
3. Check that `docs/FEATURES.md` is updated for feature changes and `docs/LESSONS.md` for non-trivial bug fixes.
