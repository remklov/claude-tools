---
name: container-change
role: implementer
description: Change Dockerfiles or compose files without touching the running stack.
when:
  paths: ["**/Dockerfile*", "**/*compose*.y*ml"]
  areas: [infra]
rules: [DOCKER-PIN]
scripts: [docker:image-pins]
---
1. Never start, stop, restart or rebuild the running stack (guards list the commands).
2. Verify compose changes with `docker compose -f <file> config`; build changed images under a scratch tag only if the brief allows it.
3. `cw run docker:image-pins --task <id>` before reporting.
4. List everything only a real deployment can verify as an open point.
