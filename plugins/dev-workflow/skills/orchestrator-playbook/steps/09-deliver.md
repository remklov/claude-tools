# O9 Deliver

1. `cw base-moved --task <id>`. Rebase needed → send the printed message to the SAME implementer, then `cw task review --task <id>` for a review of the rebase (it does not count as a round). No overlap → no rebase.
2. Unpushed commits on the base branch (`git -C <main checkout> log --oneline origin/<base>..<base>`) must not go out unasked: list them and ask before pushing anything. The workflow never pushes the base branch itself.
3. Run the deliver procedures of the active packs and the project (`cw playbook show orchestrator --task <id>`): host PR procedure (e.g. github-pr), deploy impact, migration handover, project handover.
4. `cw pr body --task <id>` renders the description from the spec, the checks, the report and the review; read it; to fix wording, pipe the corrected text into `cw pr body --task <id> --stdin`.
5. Ask the user for confirmation, naming exactly what is pushed and what a merge would deploy. Then push the task branch from the worktree and open the PR as the host procedure says; `cw pr record --task <id> --url <url>`. Never merge.
6. `cw task cleanup --task <id>` removes the worktree and the local branch when the worktree is clean and its tip is the pushed one; otherwise it keeps them and says why.
