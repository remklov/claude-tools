#!/usr/bin/env bash
# Guided setup and update of the remklov marketplace plugins for one project (docs/PLAN.md §12).
#
#   git clone --depth 1 git@github.com:remklov/claude-tools.git /tmp/dw
#   /tmp/dw/setup.sh                       # in the project root, or: /tmp/dw/setup.sh --project <dir>
#
# A configured project runs it through its committed scripts/setup-dev-workflow.sh. Each step checks,
# explains, acts only with consent and verifies; re-running the script is the update path. Answers come
# from stdin: typed in a terminal, or one line per question when piped. Run it in your own terminal,
# not inside Claude Code.
set -euo pipefail

readonly MARKETPLACE=remklov
# Added as a github source (owner/repo), which Claude Code clones over SSH; a git source with the SSH
# URL is the same marketplace.
readonly MARKETPLACE_REPO=remklov/claude-tools
readonly MARKETPLACE_URL=git@github.com:remklov/claude-tools.git
readonly SSH_TARGET=git@github.com
readonly MIN_NODE=20
readonly MIN_CLAUDE=2.1.296
readonly STEPS=10

CLONE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CLONE
readonly CW_BIN="$CLONE/plugins/dev-workflow/bin/cw"

usage() {
  cat <<'EOF'
Usage: setup.sh [--project <dir>] [--yes] [--with-progress | --no-progress] [--check] [--skip-plugins]

Sets up or updates dev-workflow (and, if you want it, agents-progress) for one project.

  --project <dir>   The project (default: the current directory); its git root is used
  --yes             Accept every default without asking; agents-progress stays off unless --with-progress
  --with-progress   Install the agents-progress display for you in this project (local scope)
  --no-progress     Do not offer agents-progress
  --check           Report what is set up and what is missing; change nothing
  --skip-plugins    Skip the SSH check, the marketplace and the plugin installs
  -h, --help        Show this help
EOF
}

project=""
assume_yes=0
progress=ask
check_only=0
skip_plugins=0
while (($#)); do
  case "$1" in
    --project)
      [[ $# -ge 2 ]] || { echo "setup.sh: --project needs a directory" >&2; exit 2; }
      project="$2"
      shift 2
      ;;
    --yes) assume_yes=1; shift ;;
    --with-progress) progress=on; shift ;;
    --no-progress) progress=off; shift ;;
    --check) check_only=1; shift ;;
    --skip-plugins) skip_plugins=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "setup.sh: unknown option $1" >&2; usage >&2; exit 2 ;;
  esac
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

open_points=0

step() { printf '\n[%s/%s] %s\n' "$1" "$STEPS" "$2"; }
say() { printf '  %s\n' "$*"; }
ok() { printf '  ok: %s\n' "$*"; }
todo() {
  printf '  todo: %s\n' "$*"
  open_points=$((open_points + 1))
}
fatal() {
  printf '\nsetup.sh: %s\n' "$1" >&2
  [[ -z "${2:-}" ]] || printf 'Fix: %s\n' "$2" >&2
  exit 1
}

# ask <question> <y|n>: the default is the capital letter. --yes takes the default; otherwise one line
# from stdin, and no line at all (stdin closed) is a no.
ask() {
  local question="$1" default="$2" hint answer
  if [[ "$default" == y ]]; then hint="[Y/n]"; else hint="[y/N]"; fi
  if ((assume_yes)); then
    printf '  %s %s %s (--yes)\n' "$question" "$hint" "$default"
    [[ "$default" == y ]]
    return
  fi
  printf '  %s %s ' "$question" "$hint"
  if ! IFS= read -r answer; then
    printf '\n'
    return 1
  fi
  [[ -t 0 ]] || printf '%s\n' "$answer"
  answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
  case "$answer" in
    y | yes) return 0 ;;
    n | no) return 1 ;;
    "") [[ "$default" == y ]] ;;
    *) return 1 ;;
  esac
}

# The value of a top-level field of one JSON object, or nothing.
json_field() {
  node -e 'try { const v = JSON.parse(process.argv[1])[process.argv[2]]; if (v !== undefined && v !== null) process.stdout.write(String(v)); } catch {}' "$1" "$2"
}

# The last line of a command's output that is a JSON object: where `claude plugin … --json` puts its result.
last_json_line() {
  printf '%s\n' "$1" | awk '/^[{]/ { line = $0 } END { print line }'
}

# version_ge <a> <b>: whether the dotted version a is at least b.
version_ge() {
  node -e 'const [a, b] = process.argv.slice(1).map((v) => v.split(".").map(Number)); for (let i = 0; i < 3; i += 1) { if ((a[i] || 0) !== (b[i] || 0)) process.exit((a[i] || 0) > (b[i] || 0) ? 0 : 1); } process.exit(0);' "$1" "$2"
}

# claude_in_root <args…>: claude with the project root as its cwd; `marketplace add --scope project`
# declares the marketplace in <cwd>/.claude/settings.json (S6).
claude_in_root() { (cd "$root" && claude "$@"); }

# plugin_cmd <args…>: a `claude plugin` command with --json; prints its message and fails on any outcome
# but ok.
plugin_cmd() {
  local out line outcome message
  out="$(claude_in_root plugin "$@" --json 2>&1)" || true
  line="$(last_json_line "$out")"
  outcome="$(json_field "$line" outcome)"
  message="$(json_field "$line" message)"
  if [[ "$outcome" == ok ]]; then
    say "${message:-claude plugin $1: ok}"
    return 0
  fi
  say "claude plugin $*: ${message:-$(printf '%s' "$out" | tail -n 3)}"
  return 1
}

cw() { (cd "$root" && node "$CW_BIN" "$@"); }

# GitHub answers ssh -T with exit 1 even when the key works; its greeting tells the two apart.
ssh_works() {
  local said
  said="$(ssh -T -o BatchMode=yes -o ConnectTimeout=10 "$SSH_TARGET" </dev/null 2>&1)" && return 0
  [[ "$said" == *"successfully authenticated"* ]]
}

# Whether a registered marketplace is this one: the github source or a git source with the SSH URL.
is_our_source() { [[ ("$1" == github && "$2" == "$MARKETPLACE_REPO") || ("$1" == git && "$2" == "$MARKETPLACE_URL") ]]; }

# --- 1. The project ---------------------------------------------------------------------------------

step 1 "Project"
[[ "${CLAUDECODE:-}" != 1 ]] || fatal "setup.sh changes plugin settings, which Claude Code protects inside a session." "Run it in your own terminal."
command -v git >/dev/null || fatal "git is not installed." "Install git 2.31 or later."
dir="${project:-$PWD}"
[[ -d "$dir" ]] || fatal "$dir is no directory." "Pass the project directory with --project <dir>."
root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || fatal "$dir is not inside a git repository." "Run setup.sh in the project, or pass --project <dir>."
if [[ "$(cd "$root" && pwd -P)" == "$(cd "$CLONE" && pwd -P)" ]] || grep -qs "\"name\": *\"$MARKETPLACE\"" "$root/.claude-plugin/marketplace.json"; then
  fatal "$root is the $MARKETPLACE marketplace itself, not a project." "Run setup.sh in the project that should use dev-workflow, or pass --project <dir>."
fi
ok "project root $root"
settings="$root/.claude/settings.json"
config="$root/.claude/dev-workflow/config.json"

# --- 2. Prerequisites -------------------------------------------------------------------------------

step 2 "Prerequisites"
command -v node >/dev/null || fatal "Node is not installed." "Install Node $MIN_NODE or later (for example with nvm or brew install node)."
node_version="$(node -p 'process.versions.node')"
version_ge "$node_version" "$MIN_NODE" || fatal "Node $node_version is too old." "Install Node $MIN_NODE or later."
ok "Node $node_version"
command -v claude >/dev/null || fatal "Claude Code (claude) is not installed." "Install it: https://code.claude.com/docs/en/setup"
claude_version="$(claude --version 2>/dev/null | awk 'NR == 1 { print $1 }')" || true
[[ -n "$claude_version" ]] || fatal "claude --version printed no version." "Check the claude installation."
version_ge "$claude_version" "$MIN_CLAUDE" || fatal "Claude Code $claude_version is older than $MIN_CLAUDE." "Update it with claude update."
ok "Claude Code $claude_version"

# --- 3. SSH to the marketplace host -----------------------------------------------------------------

step 3 "SSH to ${SSH_TARGET#git@}"
if ((skip_plugins)); then
  say "skipped (--skip-plugins)"
elif ssh_works; then
  ok "ssh $SSH_TARGET works without a prompt"
else
  say "Claude Code fetches the private marketplace with git over SSH, without prompts, and reads no token."
  say "Make the key usable without a passphrase prompt, then run setup.sh again:"
  say "  ssh-add --apple-use-keychain ~/.ssh/<your key>     (macOS; on Linux: ssh-add ~/.ssh/<your key>)"
  say "  and in ~/.ssh/config:"
  say "    Host ${SSH_TARGET#git@}"
  say "      AddKeysToAgent yes"
  say "      UseKeychain yes            (macOS only)"
  say "  If ssh asks about the host key, run ssh -T $SSH_TARGET once and accept it (known_hosts)."
  ((check_only)) || fatal "ssh -T -o BatchMode=yes $SSH_TARGET failed." "Set up the key as shown above, then run setup.sh again."
  todo "SSH to ${SSH_TARGET#git@}"
fi

# --- 4. The marketplace -----------------------------------------------------------------------------

step 4 "Marketplace $MARKETPLACE"
# The first `marketplace add` and project-scope `install` rewrite settings.json with reordered keys;
# step 5 puts the original bytes back when the content did not change (S6, Appendix B).
snapshot=""
if [[ -f "$settings" ]]; then
  snapshot="$tmp/settings.json"
  cp "$settings" "$snapshot"
fi
if ((skip_plugins)); then
  say "skipped (--skip-plugins)"
else
  listed="$(claude_in_root plugin marketplace list --json 2>/dev/null)" || listed="[]"
  # The ${...} are JavaScript template literals, not shell expansions.
  # shellcheck disable=SC2016
  known="$(node -e '
    try {
      const entry = JSON.parse(process.argv[1]).find((m) => m.name === process.argv[2]);
      if (entry) process.stdout.write(`${entry.source}\t${entry.url ?? entry.path ?? entry.repo ?? ""}`);
    } catch {}' "$listed" "$MARKETPLACE")"
  known_source="${known%%$'\t'*}"
  known_where="${known#*$'\t'}"
  if [[ -n "$known" ]] && ! is_our_source "$known_source" "$known_where"; then
    say "$MARKETPLACE is registered from $known_source $known_where. A source of the same name replaces the git one,"
    say "and its plugins then report \"not found in marketplace\" (S6)."
    if ((check_only)); then
      todo "remove the $known_source marketplace $MARKETPLACE"
    elif ask "Remove that registration (its plugins are uninstalled, then installed again from git)?" n; then
      claude_in_root plugin marketplace remove "$MARKETPLACE" >/dev/null 2>&1 || fatal "claude plugin marketplace remove $MARKETPLACE failed." "Remove it yourself: claude plugin marketplace remove $MARKETPLACE"
      ok "removed the $known_source registration"
      known=""
    else
      todo "$MARKETPLACE stays registered from $known_source $known_where"
    fi
  fi
  if ((check_only)); then
    if [[ -n "$known" ]]; then ok "registered from $known_where"; else todo "add the marketplace (claude plugin marketplace add $MARKETPLACE_REPO --scope project)"; fi
  elif [[ -n "$known" ]] && ! is_our_source "$known_source" "$known_where"; then
    say "kept the $known_source registration; no git marketplace added"
  elif ask "Declare the marketplace for this project in .claude/settings.json and fetch it?" y; then
    plugin_cmd marketplace add "$MARKETPLACE_REPO" --scope project || fatal "claude plugin marketplace add failed." "Check the message above, then run setup.sh again."
    # An existing marketplace is not refreshed by add (Appendix B).
    plugin_cmd marketplace update "$MARKETPLACE" || fatal "claude plugin marketplace update $MARKETPLACE failed." "Check the message above, then run setup.sh again."
  else
    todo "the marketplace is not declared"
  fi
fi

# --- 5. The plugins ---------------------------------------------------------------------------------

step 5 "Plugins"
installed="[]"
if ((skip_plugins)); then
  say "skipped (--skip-plugins)"
else
  installed="$(claude_in_root plugin list --json 2>/dev/null)" || installed="[]"
  has_plugin() {
    node -e 'try { const list = JSON.parse(process.argv[1]); process.exit(list.some((p) => p.id === process.argv[2] && p.scope === process.argv[3] && p.enabled) ? 0 : 1); } catch { process.exit(1); }' "$installed" "$1" "$2"
  }
  # The Desktop app loads the plugins once marketplace add and install ran; it shows no trust dialog
  # (S2, S5).
  if ((check_only)); then
    if has_plugin "dev-workflow@$MARKETPLACE" project; then ok "dev-workflow (project scope)"; else todo "install dev-workflow (project scope)"; fi
  elif ask "Install dev-workflow for everyone who works on this project (project scope)?" y; then
    plugin_cmd install "dev-workflow@$MARKETPLACE" --scope project || fatal "Installing dev-workflow failed." "Check the message above, then run setup.sh again."
    # install does not upgrade an installed plugin (Appendix B).
    plugin_cmd update "dev-workflow@$MARKETPLACE" --scope project || todo "update dev-workflow (claude plugin update dev-workflow@$MARKETPLACE --scope project)"
  else
    todo "dev-workflow is not installed"
  fi

  want_progress=0
  case "$progress" in
    on) want_progress=1 ;;
    off) ;;
    ask)
      if ((check_only)); then
        if has_plugin "agents-progress@$MARKETPLACE" local; then ok "agents-progress (local scope)"; else say "agents-progress is not installed for you (optional)"; fi
      elif ask "Install the agents progress display for you in this project?" n; then
        want_progress=1
      fi
      ;;
  esac
  if ((want_progress && !check_only)); then
    plugin_cmd install "agents-progress@$MARKETPLACE" --scope local || todo "install agents-progress (claude plugin install agents-progress@$MARKETPLACE --scope local)"
    plugin_cmd update "agents-progress@$MARKETPLACE" --scope local || true
  fi

  if [[ -n "$snapshot" && -f "$settings" ]] && ! cmp -s "$snapshot" "$settings"; then
    if node -e '
      const { readFileSync } = require("node:fs");
      const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
      const read = (path) => JSON.stringify(sorted(JSON.parse(readFileSync(path, "utf8"))));
      process.exit(read(process.argv[1]) === read(process.argv[2]) ? 0 : 1);' "$snapshot" "$settings" 2>/dev/null; then
      cp "$snapshot" "$settings"
      say "Claude Code only reordered .claude/settings.json; the original bytes are back."
    fi
  fi
  if ((!check_only)); then
    installed="$(claude_in_root plugin list --json 2>/dev/null)" || installed="[]"
    if has_plugin "dev-workflow@$MARKETPLACE" project; then ok "dev-workflow is installed and enabled"; else todo "dev-workflow is not enabled in this project"; fi
  fi
fi

# --- 6. The git host of the work repo ---------------------------------------------------------------

step 6 "Git host"
work="$root"
if [[ -f "$config" ]]; then
  app_root="$(node -e 'try { const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); if (c.workspace && c.workspace.mode === "in-place" && c.workspace.appRoot) process.stdout.write(c.workspace.appRoot); } catch {}' "$config")"
  [[ -z "$app_root" ]] || work="$root/$app_root"
fi
origin="$(git -C "$work" remote get-url origin 2>/dev/null)" || origin=""
host="$(printf '%s' "$origin" | sed -E 's#^[a-z+]+://##; s#^[^@/]*@##; s#[:/].*$##')"
if [[ -z "$host" ]]; then
  say "no origin in $work yet; cw doctor checks the host CLI once there is one"
else
  if [[ "$host" == github.com ]]; then tool=gh; else tool=glab; fi
  if ! command -v "$tool" >/dev/null; then
    todo "$tool is not installed (origin $host); install it, for example: brew install $tool"
  elif "$tool" auth status --hostname "$host" >/dev/null 2>&1; then
    ok "$tool is logged in to $host"
  elif ((check_only)); then
    todo "$tool is not logged in to $host ($tool auth login --hostname $host)"
  elif [[ -t 0 ]] && ((!assume_yes)) && ask "Log in to $host with $tool now (interactive)?" y; then
    "$tool" auth login --hostname "$host" || todo "$tool auth login --hostname $host did not finish"
  else
    todo "log in once in your terminal: $tool auth login --hostname $host"
  fi
fi

# --- 7. Tickets -------------------------------------------------------------------------------------

step 7 "Tickets"
# tickets.source of an existing config; without one cw init (step 9) asks, and cw doctor (step 10) checks.
ticket_source=local
if [[ -f "$config" ]]; then
  ticket_source="$(node -e 'try { const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.stdout.write((c.tickets && c.tickets.source) || "local"); } catch { process.stdout.write("local"); }' "$config")"
fi
case "$ticket_source" in
  linear)
    if node -e 'try { const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).mcpServers || {}; process.exit(Object.values(s).some((e) => /^https:\/\/mcp\.linear\.app\//.test(String(e && e.url))) ? 0 : 1); } catch { process.exit(1); }' "$root/.mcp.json"; then
      ok "the Linear MCP server is in .mcp.json; approve it and log in once with /mcp inside Claude Code"
    else
      say "The orchestrator reads Linear tickets through Linear's MCP server, which the project names in .mcp.json."
      say "Without it, /dev-workflow:ticket asks you to paste the ticket. To add it for the team, run"
      say "  claude mcp add --transport http --scope project linear https://mcp.linear.app/mcp/readonly"
      say "in $root, commit .mcp.json, and log in once with /mcp inside Claude Code."
      todo "no Linear MCP server in .mcp.json (optional)"
    fi
    ;;
  jira)
    if [[ "$installed" == "[]" ]]; then installed="$(claude_in_root plugin list --json 2>/dev/null)" || installed="[]"; fi
    if node -e 'try { process.exit(JSON.parse(process.argv[1]).some((p) => String(p.id).startsWith("atlassian@") && p.enabled) ? 0 : 1); } catch { process.exit(1); }' "$installed"; then
      ok "the atlassian plugin is enabled; log in once with /mcp inside Claude Code if you have not"
    else
      say "The orchestrator reads Jira tickets through Atlassian's plugin from the official marketplace."
      say "Without it, /dev-workflow:ticket asks you to paste the ticket. To read Jira, run"
      say "  claude plugin install atlassian@claude-plugins-official --scope project"
      say "in $root and log in once with /mcp inside Claude Code."
      todo "the atlassian plugin is not enabled (optional)"
    fi
    ;;
  *)
    ok "tickets are local files (tickets.contextPath); nothing to connect"
    ;;
esac

# --- 8. Local binding for the sandbox (macOS) -------------------------------------------------------

step 8 "Sandbox local binding"
user_settings="$HOME/.claude/settings.json"
if [[ "$(uname -s)" != Darwin ]]; then
  say "not needed on $(uname -s)"
elif node -e 'try { const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.exit(s.sandbox?.network?.allowLocalBinding === true ? 0 : 1); } catch { process.exit(1); }' "$user_settings"; then
  ok "sandbox.network.allowLocalBinding is on"
else
  say "Tests that bind a local port (supertest, a server on port 0) need sandbox.network.allowLocalBinding"
  say "in $user_settings. It applies to all your projects."
  if ((check_only)); then
    todo "sandbox.network.allowLocalBinding is not set"
  elif ask "Set it there (every other key stays as it is)?" y; then
    # The ${...} is a JavaScript template literal, not a shell expansion.
    # shellcheck disable=SC2016
    node -e '
      const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
      const { dirname } = require("node:path");
      const path = process.argv[1];
      const data = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
      data.sandbox = data.sandbox ?? {};
      data.sandbox.network = data.sandbox.network ?? {};
      data.sandbox.network.allowLocalBinding = true;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);' "$user_settings" || fatal "$user_settings could not be updated (is it valid JSON?)." "Set sandbox.network.allowLocalBinding to true there yourself."
    ok "set sandbox.network.allowLocalBinding"
  else
    todo "sandbox.network.allowLocalBinding is not set (cw doctor warns)"
  fi
fi

# --- 9. The project config --------------------------------------------------------------------------

step 9 "Project config"
if [[ -f "$config" ]]; then
  ok "$config exists"
elif ((check_only)); then
  todo "no project config yet (cw init --interactive)"
elif ask "Set up dev-workflow for this project now (cw init --interactive)?" y; then
  init_args=(init --interactive)
  ((!assume_yes)) || init_args+=(--yes)
  cw "${init_args[@]}" || fatal "cw init did not finish." "Run it again: node $CW_BIN init --interactive (in $root)."
else
  todo "no project config yet"
fi

# --- 10. Finish -------------------------------------------------------------------------------------

step 10 "Check"
if [[ -f "$config" ]]; then
  if cw rules build --check >/dev/null 2>&1; then
    ok "the compiled rules match the config"
  elif ((check_only)); then
    todo "the compiled rules drifted (cw rules build)"
  elif ask "The compiled rules drifted from the config. Rebuild them?" y; then
    cw rules build
  else
    todo "the compiled rules drifted"
  fi
  cw doctor --fresh || true
fi
changed="$(git -C "$root" status --porcelain -- .claude/settings.json .claude/dev-workflow .claude/rules/dev-workflow CLAUDE.md scripts/setup-dev-workflow.sh 2>/dev/null)" || changed=""
if [[ -n "$changed" ]]; then
  say ""
  say "Commit these files so the team gets the same setup:"
  printf '%s\n' "$changed" | sed 's/^/    /'
fi

printf '\n'
if ((open_points)); then
  say "$open_points point(s) above are open."
fi
if ((check_only)); then
  ((open_points == 0)) || exit 1
  exit 0
fi
say "Next: open Claude Code in $root, trust the folder, and run /dev-workflow:ticket <JIRA-KEY | NO-TICKET>."
