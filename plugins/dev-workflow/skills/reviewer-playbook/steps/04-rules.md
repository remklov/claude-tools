# R4 Rules

1. `cw rules applicable --task <id> --json` lists exactly the rules whose scope the diff touches, with their full text.
2. Check the changed code against each one; cite the rule ID in every finding.
3. Your review's `rulesChecked` is that list (`cw review save` rejects a review that skips one).
