#!/usr/bin/env sh
# Installs the local git hooks: forbidden terms in commit messages, full prepush gate.
set -e
root="$(git rev-parse --show-toplevel)"
hooks="$(git rev-parse --git-path hooks)"
cat > "$hooks/commit-msg" <<'HOOK'
#!/usr/bin/env sh
terms="$HOME/.config/claude-tools/forbidden-terms"
[ -f "$terms" ] || exit 0
if grep -v '^#' "$1" | grep -qiF -f "$terms"; then
  echo "commit message contains a forbidden term" >&2
  exit 1
fi
HOOK
printf '#!/usr/bin/env sh\nexec "%s/tools/prepush.sh"\n' "$root" > "$hooks/pre-push"
chmod +x "$hooks/commit-msg" "$hooks/pre-push"
echo "installed commit-msg and pre-push hooks"
