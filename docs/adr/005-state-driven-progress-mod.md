# ADR 005: The progress mod reads the workflow state

Status: accepted (2026-10-18), pending spike S6 in WP-61

`agents-progress` reads `<git-common-dir>/dev-workflow/state.json` instead of receiving progress tool calls from the model.

Why: progress becomes deterministic and costs no model calls. Fallback: a `progress` tool that the orchestrator playbook calls with the JSON `cw task` prints.
