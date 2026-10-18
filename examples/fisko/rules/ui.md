---
pack: project
---

## FISKO-UI-COPY — Copy and formatting
<!-- rule: severity=blocking; scope=paths:fisko-app/** -->
User-facing text is Spanish; code and comments are English. Money, dates and DTE vocabulary go through `src/lib/format.ts` and `src/lib/dteVocabulary.ts`.

## FISKO-UI-DATA — Data fetching
<!-- rule: severity=blocking; scope=paths:fisko-app/** -->
API calls go through the clients in `src/lib/` (`api.ts`, `admin-api.ts`), files through `src/lib/download.ts`. Non-ok responses and rejections show an error state; feature-gated pages mirror the API's `requireFeature` gate (`useFeature` / `FeatureRoute`).
