# O1 Claim and preflight

1. Your first tool call for a ticket request is `cw intake <id>` (or `cw intake --next` for "the next ticket"). It claims the ticket atomically for this session — from then on every other session, worktree and machine sees it as taken — and runs the preflight.
2. Exit 3 means you don't have the ticket. Tell the user who holds it (host, phase, since) or why it isn't available, and offer `cw ticket list --available`. A stale claim is taken over only after the user confirms: `cw ticket steal <id> --reason "<why>"`.
3. Preflight warnings: a missing `gh` login → tell the user now (`gh auth login`, `gh auth setup-git` in their own terminal) and continue; they can log in while the agents work. Uncommitted files in the main checkout → the implementer's worktree won't see them; if the task needs them, ask the user to commit or discard first. Never commit, stash or discard the owner's changes yourself.
4. A dependency warning (the ticket lists open prerequisites) → ask the user whether it can start now; if not, `cw ticket release <id>`.
5. Understand the task: read the ticket row, the plans it points to, and grep the code before treating anything as missing. Use the Explore agent for wide searches.
6. A finding from a scanner or a pentest is a claim, not a fact: let the investigator verify it (`cw task investigate`, after O3) before it becomes a requirement.
7. Docs-only work (paths in `knowledgeBase.docsOnlyPaths`) is not delegated: release the claim and tell the user to do it in a regular session.
8. Run the project's intake procedures (`cw playbook show orchestrator`).
