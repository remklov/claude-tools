---
name: ui-review
role: reviewer
description: Accessibility and copy checks for UI changes.
when:
  areas: [frontend]
---
1. Every new control: accessible name (label or aria-label), correct element (button vs link), reachable by keyboard.
2. Images: alt text, decorative ones `alt=""`.
3. Loading, empty and error states exist for data the UI fetches.
4. User-facing copy is in the product language; code and comments in the repository language.
5. Anything only a browser can confirm must be listed by the implementer as a `manual` open point; missing ones are non-blocking findings.
