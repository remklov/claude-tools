#!/usr/bin/env bash
# Tests for setup.sh (docs/PLAN.md §12) with stub claude, ssh, gh, glab and uname on PATH, a temporary
# HOME and a temporary project. Each case runs setup.sh once or twice and checks its output, the stub
# calls and the files. Run: bash tests/setup.test.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP="$REPO/setup.sh"
URL=git@github.com:remklov/claude-tools.git
REPO_SLUG=remklov/claude-tools
NODE_DIR="$(dirname "$(command -v node)")"
GIT_DIR_BIN="$(dirname "$(command -v git)")"

passed=0
failed=0
base="$(mktemp -d)"
trap 'rm -rf "$base"' EXIT

# The system tools without the stubbed ones: gh, glab and ssh may be installed for real (GitHub's
# runners ship gh in /usr/bin), and a case that removes a stub must not find the real tool.
SYS_BIN="$base/sys-bin"
mkdir -p "$SYS_BIN"
for dir in "$NODE_DIR" "$GIT_DIR_BIN" /usr/bin /bin; do
  for tool in "$dir"/*; do
    name="${tool##*/}"
    case "$name" in claude | ssh | gh | glab | uname) continue ;; esac
    [[ -x "$tool" && ! -e "$SYS_BIN/$name" ]] && ln -s "$tool" "$SYS_BIN/$name"
  done
done

# --- the stubs --------------------------------------------------------------------------------------

# claude: answers what setup.sh calls, as the plugin commands reference documents it (--json result
# lines, scopes), from a state directory. A project-scope add or install rewrites the project's
# settings.json with sorted keys (S6: the first one reorders), and leaves it alone when nothing changes,
# unless STUB_REORDER_ALWAYS is set.
write_stubs() {
  local bin="$1"
  mkdir -p "$bin"
  cat >"$bin/claude" <<'EOF'
#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const state = process.env.STUB_STATE;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(state, 'calls.log'), `${args.join(' ')}\n`);
const read = (name, fallback) => (fs.existsSync(path.join(state, name)) ? JSON.parse(fs.readFileSync(path.join(state, name), 'utf8')) : fallback);
const write = (name, value) => fs.writeFileSync(path.join(state, name), JSON.stringify(value));
const result = (command, outcome, message) => { console.log('some human text first'); console.log(JSON.stringify({ command, outcome, message })); process.exit(outcome === 'ok' ? 0 : 1); };
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const settingsFile = (scope) => path.join(process.cwd(), '.claude', scope === 'local' ? 'settings.local.json' : 'settings.json');
function changeSettings(scope, change) {
  const file = settingsFile(scope);
  const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const after = change(structuredClone(before));
  if (JSON.stringify(sorted(after)) === JSON.stringify(sorted(before)) && !process.env.STUB_REORDER_ALWAYS) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(sorted(after), null, 2)}\n`);
}
const [first, second, third] = args;
if (first === '--version') { console.log('2.1.308 (Claude Code)'); process.exit(0); }
if (first !== 'plugin') process.exit(2);
const marketplaces = read('marketplaces.json', []);
const plugins = read('plugins.json', []);
if (second === 'marketplace') {
  if (third === 'list') { console.log(JSON.stringify(marketplaces)); process.exit(0); }
  if (third === 'add') {
    // owner/repo is a github source, anything else a git URL (plugin marketplace reference).
    const where = args[3];
    const source = /^[\w.-]+\/[\w.-]+$/.test(where) ? { source: 'github', repo: where } : { source: 'git', url: where };
    if (!marketplaces.some((m) => m.name === 'remklov')) marketplaces.push({ name: 'remklov', ...source });
    write('marketplaces.json', marketplaces);
    changeSettings('project', (s) => ({ ...s, extraKnownMarketplaces: { ...s.extraKnownMarketplaces, remklov: { source } } }));
    result('marketplace-add', 'ok', 'Successfully added marketplace: remklov (declared in project settings)');
  }
  if (third === 'update') result('marketplace-update', 'ok', `Successfully updated marketplace: ${args[3]}`);
  if (third === 'remove') {
    write('marketplaces.json', marketplaces.filter((m) => m.name !== args[3]));
    write('plugins.json', plugins.filter((p) => !p.id.endsWith(`@${args[3]}`)));
    console.log(`Successfully removed marketplace: ${args[3]}`);
    process.exit(0);
  }
}
const scope = args[args.indexOf('--scope') + 1];
if (second === 'install') {
  if (!marketplaces.some((m) => m.name === 'remklov')) result('install', 'failed', `Plugin "${third}" not found in any marketplace`);
  if (!plugins.some((p) => p.id === third && p.scope === scope)) plugins.push({ id: third, scope, enabled: true, version: '0.1.0', installPath: '/cache' });
  write('plugins.json', plugins);
  changeSettings(scope, (s) => ({ ...s, enabledPlugins: { ...s.enabledPlugins, [third]: true } }));
  result('install', 'ok', `Successfully installed plugin: ${third} (scope: ${scope})`);
}
if (second === 'update') result('update', 'ok', `${third} is already at the latest version (0.1.0).`);
if (second === 'list') { console.log(JSON.stringify([...plugins, ...read('extra-plugins.json', [])])); process.exit(0); }
process.exit(2);
EOF
  cat >"$bin/ssh" <<'EOF'
#!/usr/bin/env bash
echo "ssh $*" >>"$STUB_STATE/calls.log"
[[ -z "${STUB_SSH_SAY:-}" ]] || echo "$STUB_SSH_SAY" >&2
exit "${STUB_SSH_EXIT:-0}"
EOF
  for tool in gh glab; do
    cat >"$bin/$tool" <<EOF
#!/usr/bin/env bash
echo "$tool \$*" >>"\$STUB_STATE/calls.log"
[[ "\$1 \$2" == "auth status" ]] && exit "\${STUB_AUTH_EXIT:-0}"
exit 0
EOF
  done
  cat >"$bin/uname" <<'EOF'
#!/usr/bin/env bash
echo "${STUB_UNAME:-Linux}"
EOF
  chmod +x "$bin"/*
}

# A case: a fresh temporary HOME, state directory and git project; sets CASE, PROJECT, STATE, BIN.
new_case() {
  CASE="$base/$1"
  PROJECT="$CASE/project"
  STATE="$CASE/state"
  BIN="$CASE/bin"
  mkdir -p "$PROJECT" "$STATE" "$CASE/home"
  : >"$STATE/calls.log"
  write_stubs "$BIN"
  git -C "$PROJECT" init -q -b main
  git -C "$PROJECT" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init
}

# run_setup <answers> [setup.sh options…]: runs setup.sh in PROJECT with the answers on stdin; sets OUT
# and STATUS. Unset CLAUDECODE: the tests may themselves run inside Claude Code.
run_setup() {
  local answers="$1"
  shift
  STATUS=0
  OUT="$(cd "$PROJECT" && printf '%b' "$answers" | env -u CLAUDECODE HOME="$CASE/home" STUB_STATE="$STATE" \
    PATH="$BIN:$SYS_BIN" bash "$SETUP" "$@" 2>&1)" || STATUS=$?
}

remove_tool() { rm -f "$BIN/$1"; }

check() {
  local name="$1"
  shift
  if "$@"; then
    passed=$((passed + 1))
    printf 'ok - %s\n' "$name"
  else
    failed=$((failed + 1))
    printf 'not ok - %s\n' "$name"
    printf '%s\n' "$OUT" | sed 's/^/    # /'
  fi
}

has() { grep -qF -- "$1" <<<"$OUT"; }
lacks() { ! has "$1"; }
called() { grep -qF -- "$1" "$STATE/calls.log"; }
not_called() { ! grep -qF -- "$1" "$STATE/calls.log"; }
# write_config <tickets JSON>: a minimal valid project config with that tickets section.
write_config() {
  mkdir -p "$PROJECT/.claude/dev-workflow"
  printf '{"version":1,"project":{"name":"x"},"packs":[],"packages":[{"id":"a","path":".","areas":["backend"]}],"tickets":%s}\n' "$1" >"$PROJECT/.claude/dev-workflow/config.json"
}
settings_has() { node -e 'const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.exit(eval(process.argv[2]) ? 0 : 1)' "$PROJECT/.claude/settings.json" "$1"; }

# --- the cases --------------------------------------------------------------------------------------

new_case fresh
run_setup 'y\ny\nn\nn\n'
check "fresh run: exit 0" test "$STATUS" -eq 0
check "fresh run: the marketplace is added as the github source in project scope, then updated" called "plugin marketplace add $REPO_SLUG --scope project --json"
check "fresh run: marketplace update follows the add" called "plugin marketplace update remklov --json"
check "fresh run: dev-workflow is installed and updated in project scope" called "plugin install dev-workflow@remklov --scope project --json"
check "fresh run: install is followed by update" called "plugin update dev-workflow@remklov --scope project --json"
check "fresh run: agents-progress declined" not_called "agents-progress"
check "fresh run: settings.json declares the marketplace and enables dev-workflow" settings_has 's.extraKnownMarketplaces["remklov"] && s.enabledPlugins["dev-workflow@remklov"] === true'
check "fresh run: it names settings.json among the files to commit" has ".claude/settings.json"
check "fresh run: the SSH check runs in batch mode" called "ssh -T -o BatchMode=yes -o ConnectTimeout=10 git@github.com"
check "fresh run: the next step names the command" has "/dev-workflow:ticket"

cp "$PROJECT/.claude/settings.json" "$CASE/after-first.json"
run_setup 'y\ny\nn\nn\n'
check "re-run: exit 0" test "$STATUS" -eq 0
check "re-run: settings.json stays byte-identical" cmp -s "$CASE/after-first.json" "$PROJECT/.claude/settings.json"

new_case declined
run_setup 'n\nn\nn\nn\n'
check "declined: exit 0" test "$STATUS" -eq 0
check "declined: no marketplace add" not_called "marketplace add"
check "declined: no install" not_called "plugin install"
check "declined: no settings.json written" test ! -e "$PROJECT/.claude/settings.json"
check "declined: the open points are counted" has "point(s) above are open"

new_case closed-stdin
run_setup ''
check "no answers at all: nothing is installed" not_called "plugin install"

new_case ssh
STUB_SSH_EXIT=255 run_setup 'y\ny\nn\nn\n'
check "SSH failure: exit 1" test "$STATUS" -eq 1
check "SSH failure: it explains the key setup" has "ssh-add --apple-use-keychain"
check "SSH failure: no marketplace call" not_called "plugin marketplace"

new_case ssh-greeting
STUB_SSH_EXIT=1 STUB_SSH_SAY="Hi remklov! You've successfully authenticated, but GitHub does not provide shell access." run_setup 'y\ny\nn\nn\n'
check "GitHub's exit 1 with its greeting: SSH works" has "ssh git@github.com works without a prompt"
check "GitHub's exit 1 with its greeting: the marketplace is added" called "plugin marketplace add $REPO_SLUG --scope project --json"

new_case github-source-registered
printf '%s' '[{"name":"remklov","source":"github","repo":"remklov/claude-tools"}]' >"$STATE/marketplaces.json"
run_setup 'y\ny\nn\nn\n'
check "registered as the github source: no removal offered" lacks "Remove that registration"
check "registered as the github source: it is refreshed" called "plugin marketplace update remklov --json"

new_case github-missing
git -C "$PROJECT" remote add origin git@github.com:acme/app.git
remove_tool gh
run_setup 'y\ny\nn\nn\n'
check "gh missing: it names the install" has "gh is not installed (origin github.com); install it, for example: brew install gh"

new_case gitlab-logged-out
git -C "$PROJECT" remote add origin git@gitlab.example.com:group/app.git
STUB_AUTH_EXIT=1 run_setup 'y\ny\nn\nn\n'
check "glab not logged in: it asks glab for the host" called "glab auth status --hostname gitlab.example.com"
check "glab not logged in: it names the login without a terminal" has "glab auth login --hostname gitlab.example.com"
check "glab not logged in: no login runs without a terminal" not_called "glab auth login"

new_case directory-marketplace
printf '%s' '[{"name":"remklov","source":"directory","path":"/Users/x/claude-dev-workflow"}]' >"$STATE/marketplaces.json"
run_setup 'n\ny\nn\nn\n'
check "directory marketplace: it warns about the same-name source" has "registered from directory /Users/x/claude-dev-workflow"
check "directory marketplace kept: no git add over it" not_called "marketplace add"
new_case directory-marketplace-removed
printf '%s' '[{"name":"remklov","source":"directory","path":"/Users/x/claude-dev-workflow"}]' >"$STATE/marketplaces.json"
run_setup 'y\ny\ny\nn\nn\n'
check "directory marketplace removed: remove, then the git add" called "plugin marketplace remove remklov"
check "directory marketplace removed: the github marketplace is added" called "plugin marketplace add $REPO_SLUG --scope project --json"

new_case reorder
mkdir -p "$PROJECT/.claude"
cat >"$PROJECT/.claude/settings.json" <<EOF
{
  "permissions": { "allow": ["Bash(cw *)"] },
  "extraKnownMarketplaces": { "remklov": { "source": { "source": "github", "repo": "$REPO_SLUG" } } },
  "enabledPlugins": { "dev-workflow@remklov": true }
}
EOF
cp "$PROJECT/.claude/settings.json" "$CASE/original.json"
STUB_REORDER_ALWAYS=1 run_setup 'y\ny\nn\nn\n'
check "reorder only: the original bytes are back" cmp -s "$CASE/original.json" "$PROJECT/.claude/settings.json"
check "reorder only: it says so" has "only reordered .claude/settings.json"

new_case yes
run_setup '' --yes
check "--yes: exit 0" test "$STATUS" -eq 0
check "--yes: dev-workflow is installed" called "plugin install dev-workflow@remklov --scope project --json"
check "--yes: agents-progress stays off" not_called "agents-progress"
new_case yes-progress
run_setup '' --yes --with-progress
check "--yes --with-progress: agents-progress in local scope" called "plugin install agents-progress@remklov --scope local --json"
check "--yes --with-progress: settings.local.json enables it" grep -q '"agents-progress@remklov": true' "$PROJECT/.claude/settings.local.json"

new_case check-mode
run_setup '' --check
check "--check: exit 1 with open points" test "$STATUS" -eq 1
check "--check: no add or install" not_called "marketplace add"
check "--check: it lists what is missing" has "todo: install dev-workflow (project scope)"

new_case linear
write_config '{"source":"linear","contextPath":"docs/specs/{key}.md"}'
run_setup '' --check
check "linear: it names the Linear server for .mcp.json" has "claude mcp add --transport http --scope project linear https://mcp.linear.app/mcp/readonly"
check "linear: no Jira hint" lacks "atlassian"
printf '%s\n' '{"mcpServers":{"linear":{"type":"http","url":"https://mcp.linear.app/mcp/readonly"}}}' >"$PROJECT/.mcp.json"
run_setup '' --check
check "linear with .mcp.json: the server is found" has "the Linear MCP server is in .mcp.json"

new_case local-tickets
write_config '{"source":"local","contextPath":"docs/specs/{key}.md"}'
run_setup '' --check
check "local: nothing to connect" has "tickets are local files"

new_case macos
STUB_UNAME=Darwin run_setup 'y\ny\nn\ny\nn\n'
check "macOS: allowLocalBinding is set with consent" node -e 'process.exit(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).sandbox.network.allowLocalBinding === true ? 0 : 1)' "$CASE/home/.claude/settings.json"

new_case macos-keeps-keys
mkdir -p "$CASE/home/.claude"
printf '%s\n' '{ "model": "opus", "sandbox": { "enabled": true } }' >"$CASE/home/.claude/settings.json"
STUB_UNAME=Darwin run_setup 'y\ny\nn\ny\nn\n'
check "macOS: the other user settings stay" node -e 'const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.exit(s.model === "opus" && s.sandbox.enabled === true && s.sandbox.network.allowLocalBinding === true ? 0 : 1)' "$CASE/home/.claude/settings.json"

new_case marketplace-repo
PROJECT="$REPO"
run_setup '' --check
check "the marketplace repository itself is refused" has "is the remklov marketplace itself"

new_case inside-claude
STATUS=0
OUT="$(cd "$PROJECT" && CLAUDECODE=1 HOME="$CASE/home" STUB_STATE="$STATE" PATH="$BIN:$SYS_BIN" bash "$SETUP" </dev/null 2>&1)" || STATUS=$?
check "inside Claude Code it refuses and names the terminal" has "Run it in your own terminal."

printf '\n%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
