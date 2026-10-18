---
pack: docker
---

## DOCKER-PIN — Pinned images
<!-- rule: severity=blocking; scope=paths:**/Dockerfile*|**/*compose*.y*ml -->
New or changed container images use a full version tag or a digest (for example `node:22.13.1-alpine`). No `latest`, no untagged images and no major-only tags.
