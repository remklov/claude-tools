---
name: probe-wt
description: Spike probe agent. Only for spike tests.
model: claude-sonnet-5-5
effort: low
isolation: worktree
tools: Read, Bash, Edit, Write
skills:
  - spike:pb-test
---
You are a probe for platform tests. Do exactly what the prompt asks and report raw outputs verbatim.
