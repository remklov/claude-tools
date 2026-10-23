#!/usr/bin/env bash
# Sets up or updates the dev-workflow plugins for this project: clones the remklov
# marketplace into a temporary directory and runs its guided setup.sh for this project's root.
# Re-running it is the update path. Run it in your own terminal, not inside Claude Code.
set -euo pipefail

url="git@github.com:remklov/claude-tools.git"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git clone --quiet --depth 1 "$url" "$tmp/dw"
# Not exec: exec would replace this shell, so the EXIT trap would never remove the clone.
bash "$tmp/dw/setup.sh" --project "$root" "$@"
