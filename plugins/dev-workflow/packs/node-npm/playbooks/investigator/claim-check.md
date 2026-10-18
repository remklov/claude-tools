---
name: claim-check
role: investigator
description: Verify a scanner or pentest finding against the pinned versions and the code before it becomes work.
when:
  keywords: [audit, vulnerability, CVE, pentest, scanner, advisory, finding]
---
1. A finding is a claim, not a fact: the tool may have read a stale lockfile or tested another version.
2. For each package it names, `cw deps where <package>` and compare with the affected version range.
3. Check whether the vulnerable code path is reachable from this repository's code.
4. Report per finding: confirmed, not applicable (with evidence), or unclear (with what is needed).
