---
pack: github-actions
---

## GHA-PIN — Pinned actions and images
<!-- rule: severity=blocking; scope=paths:.github/workflows/** -->
New or changed actions and job images are pinned ({options.actionPinning}: a full version tag such as `actions/checkout@v4.2.2`, or a commit SHA). No branch refs and no major-only tags for container images.

## GHA-SECRETS — Secrets in CI
<!-- rule: severity=blocking; scope=paths:.github/workflows/**; protected=true -->
Secrets come only from GitHub Actions secrets or a secret manager; they are never written to files in the repository or printed to logs.
