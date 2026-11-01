# O9 Deliver

Goal: the approved branch is pushed and has a PR/MR (or the user decided against one), and its URL is recorded. `cw` never pushes; you run its printed commands after the user confirmed them.

## 1. The PR/MR body

Write What & why's summary of the change, three to six lines in the reader's words (what changed and where; no headings), with the Write tool to a new file in your scratchpad directory, then:

```bash
cw pr body --task <id> --what <scratchpad>/<id>-what-1.md
```

It writes the body around it from the spec, the report and the final review, and prints it: the ticket and the spec's context lead What & why; Testing names the passing checks per package and the holding proofs; Risks & deploy steps take the spec's Risks and deploy steps and the report's risks; Open points hold the report's open points and the final review's non-blocking findings with the user's decisions. Check it against the git preset: Testing lists only what was verified; no attribution lines unless the user's own instructions require them. Only when something is wrong, write the whole corrected body (only the preset's sections; `cw` keeps the trailers) to a new file in your scratchpad directory and pass it on stdin:

```bash
cw pr body --task <id> --stdin < <scratchpad>/<id>-pr-body-1.md
```

## 2. The commands

```bash
cw pr command --task <id>
```

It prints the host, the commands (the push, and the create command unless an open PR/MR exists), the record command and notes. `cw pr title --task <id>` prints the title alone.

- An open PR/MR exists: push only; its URL is in the record command.
- A merged or closed PR/MR for the branch (exit 3): ask the user how to continue.
- A note that the base branch has commits origin lacks, or that origin's base is unknown locally: ask the user before anything is pushed; the push would carry them.
- No remote or no supported host (`cw doctor` says so): ask the user, then `cw pr record --task <id> --skipped "<reason>"`.

## 3. Ask, naming exactly what is pushed

One AskUserQuestion with: the branch, its commits (count and summaries), the remote and host, the base, the PR/MR title (or "push to the existing PR/MR <url>"), and any note from step 2. Options: "Push and create", "Not now".

## 4. Run and record

Only after a yes, run the printed commands one by one with Bash, exactly as printed (the push in the `git -C` form `cw` prints; a permission prompt for it may follow). Never add `--force`, never merge. Take the https URL of the PR/MR from the `gh` or `glab` output, then:

```bash
cw pr record --task <id> --url <url>
```

- A command fails: show the user the error and the fix it names (for example a missing `gh auth login` or `glab auth login`, which the user runs in their terminal); do not retry with other flags.
- The user says no: ask whether to keep the task open (stop here; the user resumes later with `/dev-workflow:ticket <KEY>`) or to end delivery without a PR/MR: `cw pr record --task <id> --skipped "<the user's reason>"`.

Continue with O10.
