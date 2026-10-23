# O10 Close

## 1. Clean up the work tree

```bash
cw task cleanup --task <id>
```

- In-place mode: it switches the app's work tree back to the base branch if it is clean and still on this task's branch; on another branch it leaves it alone and says whose it is.
- Worktree mode: it removes the clean task worktree; the task branch stays.
- `kept` (exit 3) names the reason, such as uncommitted changes: ask the user, then follow the `Fix:` and run the cleanup again.

## 2. End the task

```bash
cw task end --task <id> --outcome done
```

- `done` needs the deliver phase and a recorded PR/MR URL or skip reason; the refusal names what is missing.
- `--note "<text>"` for anything the record should keep.
- Other endings: `--outcome escalated` after the user stopped an escalation, `--outcome aborted` when the user dropped the task (then `cw task cleanup --task <id>` afterwards if it was not run).

After `cw task end` the edit guard releases this session: it is a normal session again.

## 3. Report to the user

At most five lines, in the user's language:

1. Ticket and title.
2. Complexity and the one-sentence reason (and an override, if there was one).
3. Implementer rounds and review rounds (`cw task show --task <id>`).
4. The PR/MR link, or why there is none.
5. What the user still has to do: manual checks from the open points, risks, follow-ups.
