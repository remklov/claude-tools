#!/usr/bin/env sh
# Installs the local git hooks of this repository: commit-msg checks the message and the author against
# the private-terms list, pre-push runs tools/prepush.sh (the CI checks).
set -e
root="$(git rev-parse --show-toplevel)"
hooks="$(git rev-parse --git-path hooks)"
cat >"$hooks/commit-msg" <<'HOOK'
#!/usr/bin/env sh
terms="${FORBIDDEN_TERMS_FILE:-$HOME/.config/claude-tools/forbidden-terms}"
[ -f "$terms" ] || exit 0
list="$(grep -v -e '^#' -e '^[[:space:]]*$' "$terms")" || exit 0
if grep -v '^#' "$1" | grep -qiF -e "$list"; then
  echo "commit-msg: the message contains a term of the private list" >&2
  exit 1
fi
if git var GIT_AUTHOR_IDENT | grep -qiF -e "$list"; then
  echo "commit-msg: the author name or email contains a term of the private list (git config user.email)" >&2
  exit 1
fi
HOOK
printf '#!/usr/bin/env sh\nexec "%s/tools/prepush.sh"\n' "$root" >"$hooks/pre-push"
chmod +x "$hooks/commit-msg" "$hooks/pre-push"
echo "installed the commit-msg and pre-push hooks"
