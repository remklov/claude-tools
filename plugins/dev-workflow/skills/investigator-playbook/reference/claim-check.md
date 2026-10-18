# Claim check (scanner and pentest findings)

A finding is a claim, not a fact: the tool may have read a stale lockfile or tested another version. For each package it names, compare the affected range with the pinned version (`cw deps where`), and check whether the vulnerable code path is reachable from this repository. Report each finding as confirmed, not applicable (with evidence) or unclear (with what is needed).
