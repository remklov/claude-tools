---
name: dependency-trace
role: investigator
description: Trace how a dependency behaves in the version the project pins.
when:
  keywords: [dependency, library, package, upgrade, version, router, parser, client]
---
1. `cw deps where <package>` → the pinned version and its directory in `node_modules`.
2. Read the dependency's code in that directory (not its latest docs) for the behaviour in question.
3. Reproduce with a small script in a scratch directory if the code path is unclear; never change the repository.
4. In each finding set `basis` to `traced` (seen in code or a run) or `reasoned` (inferred).
