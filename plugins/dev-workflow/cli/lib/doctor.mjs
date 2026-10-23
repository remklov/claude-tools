// Setup checks for cw doctor and the SessionStart hook (§9, D11): no network, results cached in the
// state dir for 12 h, keyed by the mtimes of the files they read, the tools (resolved path, mtime and
// size, so an update at the same PATH entry counts) and the versions.
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { gitVersion } from './git.mjs';
import { detectHost } from './host/index.mjs';
import { readJson, writeJson } from './fsx.mjs';
import { PROJECT_PACKS_DIR, PROJECT_PROCEDURES_DIR, resolvePacks } from './packs.mjs';
import { packsDir, pluginVersion } from './paths.mjs';
import { run, which } from './proc.mjs';
import { LOCK_FILE, OUT_DIR, PROJECT_RULES_DIR, buildRulebook, checkRulebook } from './rules.mjs';
import { CONFIG_RELATIVE, findConfigRoot, loadWorkspace, resolveGitDirs } from './workspace.mjs';

// claude: D10. git: `rev-parse --path-format=absolute` (used by the agents-progress mod) is believed
// to need 2.31; not verified against the git release notes.
export const MIN = { node: 20, git: '2.31.0', claude: '2.1.296' };
export const CACHE_TTL_MS = 12 * 3600_000;
const CONTEXT_MAX = 10_000;

export function compareVersions(a, b) {
  const parts = (version) => String(version).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

const check = (id, label, level, ok, message, fix = '') => ({ id, label, level, ok, message, fix: ok ? '' : fix });

function readSettings(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

const userSettingsPath = (env, home) => join(env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'settings.json');

function claudeCheck(env) {
  const path = which('claude', env);
  if (!path) return check('claude', 'claude version', 'error', true, 'claude is not on PATH; its version was not checked.');
  const result = run(path, ['--version'], { env, timeoutMs: 10_000 });
  const version = /(\d+\.\d+\.\d+)/.exec(result.stdout)?.[1];
  if (!version) return check('claude', 'claude version', 'error', true, `claude --version printed no version (exit ${result.code}); not checked.`);
  const ok = compareVersions(version, MIN.claude) >= 0;
  return check('claude', 'claude too old', 'error', ok, `Claude Code ${version} (needs ≥ ${MIN.claude}).`, 'Update Claude Code: claude update.');
}

function workRepoCheck(ws) {
  if (ws.mode !== 'in-place') return check('work-repo', 'work repo', 'error', true, `Work repo: ${ws.workRepo}.`);
  const dirs = resolveGitDirs(ws.workRepo);
  const ok = Boolean(dirs) && resolve(dirs.repoRoot) === resolve(ws.workRepo);
  return check('work-repo', `${ws.appRoot}/ is no git repo`, 'error', ok,
    ok ? `Work repo: ${ws.workRepo}.` : `${ws.appRoot}/ is not a git repository of its own; in-place mode needs the application cloned there.`,
    `Clone the application repository into ${ws.workRepo}.`);
}

function stateDirCheck(ws) {
  try {
    mkdirSync(ws.stateDir, { recursive: true });
    accessSync(ws.stateDir, constants.W_OK);
    return check('state-dir', 'state dir', 'error', true, `State dir: ${ws.stateDir}.`);
  } catch (error) {
    return check('state-dir', 'state dir not writable', 'error', false, `The state dir ${ws.stateDir} is not writable: ${error.message}.`, `Make ${ws.stateDir} writable for your user.`);
  }
}

function hostCliCheck(ws, env) {
  const host = detectHost({ workTree: ws.workRepo, config: ws.config });
  if (host.kind === 'none') {
    return check('host-cli', 'host CLI', 'warning', true, 'The work repo has no remote host; delivery ends with cw pr record --skipped.');
  }
  const ok = Boolean(which(host.cli, env));
  const where = host.hostname ? ` on ${host.hostname}` : '';
  return check('host-cli', `${host.cli} not installed`, 'warning', ok,
    ok ? `${host.cli} is installed for the ${host.kind} work repo${where}.` : `${host.cli} is not installed; the work repo's origin is${where || ' set by git.host'} (${host.kind}).`,
    `brew install ${host.cli}, then ${host.cli} auth login --hostname ${host.hostname ?? '<host>'} in your own terminal.`);
}

// "packs resolve" (error) and "rules drift" (warning) from ws (§9 SessionStart). Without resolved
// packs there is no rulebook to compare, so the drift check is left out; rules that do not compile
// are an error, since cw rules build and the review fail on them too.
export function rulesAndPacksChecks(ws) {
  let packs;
  try {
    packs = resolvePacks(ws);
  } catch (error) {
    return [check('packs', 'packs do not resolve', 'error', false, error.message, error.fix || `Correct packs in ${CONFIG_RELATIVE}.`)];
  }
  const results = [check('packs', 'packs', 'error', true, `Packs resolve: ${packs.map((pack) => (pack.variant ? `${pack.id} (${pack.variant})` : pack.id)).join(', ')}.`)];
  let drift;
  try {
    drift = checkRulebook(ws, buildRulebook(ws, packs));
  } catch (error) {
    results.push(check('rules', 'rules do not compile', 'error', false, error.message, error.fix || 'Correct the named rule files, then run cw rules build in a terminal.'));
    return results;
  }
  const kinds = new Map();
  for (const problem of drift.problems) kinds.set(problem.kind, (kinds.get(problem.kind) ?? 0) + 1);
  results.push(check('rules', 'rules drift', 'warning', drift.isCurrent,
    drift.isCurrent
      ? `Rules up to date in ${OUT_DIR}/.`
      : `The compiled rules in ${OUT_DIR}/ are out of date (${[...kinds].map(([kind, count]) => `${kind}: ${count}`).join(', ')}).`,
    'Run cw rules build in a terminal.'));
  return results;
}

// Every file and directory below dir, in name order; a directory's mtime changes when an entry is
// added or removed. A missing dir is listed alone (stamped as missing).
function treeOf(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [dir];
  }
  return [dir, ...entries.flatMap((entry) => (entry.isDirectory() ? treeOf(join(dir, entry.name)) : [join(dir, entry.name)]))];
}

// What the packs and rules checks read (a superset of the rulebook's inputs): the bundled and project
// packs, the project rules and procedures, the rules.add and override files, the lock and the compiled
// rules.
function rulesInputs(configRoot, config) {
  const trees = [packsDir, ...[PROJECT_PACKS_DIR, PROJECT_PROCEDURES_DIR, PROJECT_RULES_DIR, OUT_DIR].map((dir) => join(configRoot, dir))];
  const named = config ? [...config.rules.add, ...Object.values(config.rules.override).map((item) => item.file)] : [];
  return [...trees.flatMap(treeOf), join(configRoot, LOCK_FILE), ...named.map((file) => resolve(configRoot, file))];
}

// Jira is read through Atlassian's plugin from the official marketplace (atlassian@claude-plugins-official).
function atlassianCheck(files) {
  const enabled = files.some((file) => Object.entries(readSettings(file).enabledPlugins ?? {}).some(([id, on]) => on === true && id.startsWith('atlassian@')));
  return check('atlassian', 'atlassian not enabled', 'warning', enabled,
    enabled ? 'The atlassian plugin is enabled (Jira).' : 'The atlassian plugin is not enabled, so the orchestrator cannot read Jira tickets (it asks you to paste them).',
    'Install it with claude plugin install atlassian@claude-plugins-official --scope project, then log in once with /mcp in Claude Code.');
}

// A Linear server in the project's .mcp.json (project scope). Servers of the local and user scope live
// in ~/.claude.json, which this check does not read (code.claude.com/docs/en/mcp).
function linearCheck(configRoot) {
  const servers = Object.entries(readSettings(join(configRoot, '.mcp.json')).mcpServers ?? {});
  const server = servers.find(([, entry]) => /^https:\/\/mcp\.linear\.app\//.test(String(entry?.url ?? '')));
  return check('linear-mcp', 'Linear MCP not in .mcp.json', 'warning', Boolean(server),
    server
      ? `Linear MCP server "${server[0]}" in .mcp.json; log in once with /mcp in Claude Code.`
      : 'tickets.source is linear, but .mcp.json has no Linear MCP server, so the orchestrator asks you to paste tickets (unless you added one at local or user scope).',
    'Add it for the team with claude mcp add --transport http --scope project linear https://mcp.linear.app/mcp/readonly, commit .mcp.json, then log in once with /mcp in Claude Code.');
}

// The folder of the local ticket files: the part of tickets.contextPath before {key}.
const ticketDirOf = (contextPath) => posix.dirname(`${contextPath.slice(0, contextPath.indexOf('{key}'))}x`);

function ticketFilesCheck(configRoot, contextPath) {
  const dir = ticketDirOf(contextPath);
  const ok = existsSync(join(configRoot, dir));
  return check('ticket-files', 'ticket folder missing', 'warning', ok,
    ok ? `Local tickets in ${dir}/ (tickets.contextPath ${contextPath}).` : `tickets.source is local, but ${dir}/ does not exist.`,
    `Create ${dir}/ with one file per ticket (tickets.contextPath ${contextPath}).`);
}

// The check of the ticket source's way in; an invalid config falls back to the Jira default.
function ticketSourceCheck(configRoot, config, settingsFiles) {
  if (config?.tickets.source === 'linear') return linearCheck(configRoot);
  if (config?.tickets.source === 'local') return ticketFilesCheck(configRoot, config.tickets.contextPath);
  return atlassianCheck(settingsFiles);
}

function localBindingCheck(path) {
  const ok = readSettings(path).sandbox?.network?.allowLocalBinding === true;
  return check('allow-local-binding', 'allowLocalBinding off', 'warning', ok,
    ok ? 'The sandbox allows local binding.' : `sandbox.network.allowLocalBinding is not true in ${path}; sandboxed API tests and dev servers fail with EPERM.`,
    `Run setup.sh (it sets the key with your consent), or set it in ${path} yourself; it applies to all your projects.`);
}

function computeChecks({ configRoot, ws, configError, env, platform, home, quick }) {
  const results = [];
  const node = Number(process.versions.node.split('.')[0]);
  results.push(check('node', 'Node too old', 'error', node >= MIN.node, `Node ${process.versions.node} (needs ≥ ${MIN.node}).`, `Install Node ${MIN.node} or later.`));
  const gitV = gitVersion().join('.');
  results.push(check('git', 'git too old', 'error', compareVersions(gitV, MIN.git) >= 0, `git ${gitV} (needs ≥ ${MIN.git}).`, `Install git ${MIN.git} or later.`));
  if (!quick) results.push(claudeCheck(env));
  if (configError) results.push(check('config', 'config invalid', 'error', false, configError.message, configError.fix || 'Run cw config validate.'));
  else results.push(check('config', 'config', 'error', true, `Config valid: ${ws.configPath}.`));
  if (ws) {
    const repo = workRepoCheck(ws);
    results.push(repo, stateDirCheck(ws));
    if (repo.ok) results.push(hostCliCheck(ws, env));
    results.push(...rulesAndPacksChecks(ws));
  }
  const userSettings = userSettingsPath(env, home);
  const projectSettings = ['settings.json', 'settings.local.json'].map((name) => join(configRoot, '.claude', name));
  results.push(ticketSourceCheck(configRoot, ws?.config, [userSettings, ...projectSettings]));
  if (platform === 'darwin') results.push(localBindingCheck(userSettings));
  return results;
}

function cacheKey({ configRoot, env, platform, home, files }) {
  const stamp = (path) => {
    try {
      const stat = statSync(path);
      return [path, stat.mtimeMs, stat.size];
    } catch {
      return [path, null, null];
    }
  };
  const tool = (name) => {
    const path = which(name, env);
    if (!path) return null;
    try {
      return [path, ...stamp(realpathSync(path))];
    } catch {
      return [path];
    }
  };
  const parts = {
    files: files.map(stamp),
    tools: ['claude', 'gh', 'glab', 'git'].map(tool),
    plugin: pluginVersion(),
    node: process.version,
    path: env.PATH ?? '',
    platform,
    home,
    configRoot,
  };
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

// { configRoot, stateDir, results, cached }; no config -> configRoot null and no results.
// quick skips spawning claude and accepts a cached result of any age.
export function runDoctor({ cwd, env = process.env, platform = process.platform, home, quick = false, fresh = false, now = Date.now() } = {}) {
  const configRoot = findConfigRoot(cwd);
  if (!configRoot) return { configRoot: null, stateDir: null, results: [], cached: false };
  const homeDir = home ?? env.HOME ?? homedir();
  const dirs = resolveGitDirs(configRoot);
  const stateDir = dirs ? join(dirs.commonDir, 'dev-workflow') : null;
  const files = [
    join(configRoot, CONFIG_RELATIVE), userSettingsPath(env, homeDir), join(configRoot, '.claude', 'settings.json'), join(configRoot, '.claude', 'settings.local.json'),
    join(configRoot, '.mcp.json'),
  ];
  let ws = null;
  let configError = null;
  try {
    ws = loadWorkspace({ cwd: configRoot });
  } catch (error) {
    configError = error;
  }
  // The origin decides the host check.
  const workDirs = ws ? resolveGitDirs(ws.workRepo) : null;
  if (workDirs) files.push(join(workDirs.commonDir, 'config'));
  if (ws) files.push(...rulesInputs(configRoot, ws.config));
  if (ws?.config.tickets.source === 'local') files.push(join(configRoot, ticketDirOf(ws.config.tickets.contextPath)));
  const key = cacheKey({ configRoot, env, platform, home: homeDir, files });
  const cacheFile = stateDir ? join(stateDir, 'doctor-cache.json') : null;
  if (cacheFile && !fresh) {
    let cache = null;
    try {
      cache = readJson(cacheFile, null);
    } catch {
      cache = null;
    }
    if (cache?.key === key && (quick || (!cache.quick && now - cache.at < CACHE_TTL_MS))) {
      return { configRoot, stateDir, results: cache.results, cached: true };
    }
  }
  const results = computeChecks({ configRoot, ws, configError, env, platform, home: homeDir, quick });
  if (cacheFile) {
    try {
      writeJson(cacheFile, { key, at: now, quick, results });
    } catch {
      // A cache that cannot be written is only slower.
    }
  }
  return { configRoot, stateDir, results, cached: false };
}

// The SessionStart output for failed checks, or null when everything is fine. A cached result says so,
// since the problem may be fixed already.
export function hookOutput(results, { cached = false } = {}) {
  const failed = results.filter((result) => !result.ok);
  if (!failed.length) return null;
  const cap = (text) => (text.length > CONTEXT_MAX ? `${text.slice(0, CONTEXT_MAX - 1)}…` : text);
  const facts = failed.map((result) => `- [${result.level}] ${result.message} Fix: ${result.fix}`);
  const details = cached ? 'Cached result; cw doctor --fresh checks again.' : 'Details: cw doctor';
  return {
    systemMessage: cap(`dev-workflow: ${failed.length} setup issue${failed.length === 1 ? '' : 's'} (${failed.map((result) => result.label).join('; ')}). ${details}`),
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: cap(`dev-workflow setup facts:\n${facts.join('\n')}`) },
  };
}
