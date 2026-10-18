# Changelog

## 0.1.0 — unreleased

### dev-workflow
- `cw` CLI: profile and pack loading, rules engine (layers, variants, customizations, aliases, compiled rulebook with lock), claim registry on git refs with intake, ID reservation and backlog merge driver, task state machine, spec lint, classification, briefs and delegation texts, checks with services and exclusive locks, prove and mutate in scratch copies, commit message build and lint, reports, reviews, investigations, base-moved, PR body, cleanup, doctor, init.
- Agents: orchestrator, implementer-s/m/l/xl (generated), reviewer, investigator. No Fable models.
- Skills: orchestrator-, implementer-, reviewer- and investigator-playbook; `/dev-workflow:ticket`, `/dev-workflow:setup`.
- Hooks: SessionStart (doctor, rulebook drift), SubagentStart (role context), SubagentStop (result validation), PreToolUse guard, UserPromptSubmit ticket intent.
- Packs: core, git-github, node-npm, typescript, express (4, 5), react-vite (react-18, react-19), tailwind, vitest, postgres-sql (numbered-sql, drizzle-kit), docker, github-actions.

### agents-progress
- Moved from the earlier workflow repository, renamed, state-driven (reads the workflow state instead of a progress tool), avatars by role and area, scientist costume for the investigator, step progress, planned tasks, foreign claims in the band.
