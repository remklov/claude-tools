// What every hook needs before it acts (§9, D11): where the project is (inert without a config), the
// state dir for the log and the cache, and the config and pack guards, cached by the mtimes of the
// files they are read from. No network and, in a normal checkout, no git process.
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadConfig } from '../../cli/lib/config.mjs';
import { cachedByMtime } from '../../cli/lib/fsx.mjs';
import { PROJECT_PACKS_DIR, packGuards, resolvePacks } from '../../cli/lib/packs.mjs';
import { packsDir, pluginRoot, presetsDir } from '../../cli/lib/paths.mjs';
import { CONFIG_RELATIVE, findConfigRoot, resolveGitDirs } from '../../cli/lib/workspace.mjs';

export const CACHE_FILE = 'hooks-cache.json';
const ROLE = /^dev-workflow:(implementer-(?:s|m|l|xl)|reviewer)$/;

// implementer or reviewer for the workflow's agents; null for the main session and other agents.
export function roleOf(agentType) {
  const match = ROLE.exec(String(agentType ?? ''));
  if (!match) return null;
  return match[1] === 'reviewer' ? 'reviewer' : 'implementer';
}

// The path with symlinks resolved as far as it exists, so /var and /private/var compare equal.
export function canonical(path) {
  const rest = [];
  let dir = resolve(path);
  while (!existsSync(dir) && dirname(dir) !== dir) {
    rest.unshift(basename(dir));
    dir = dirname(dir);
  }
  try {
    return join(realpathSync(dir), ...rest);
  } catch {
    return resolve(path);
  }
}

export const isInside = (path, dir) => {
  const rel = relative(dir, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

// The project around cwd: { cwd, configRoot, configPath, repoRoot, gitDir, commonDir, stateDir }; null
// without a config (every hook is then a no-op). Outside a git repository the git fields and stateDir
// are null: there is no task state, and only SessionStart reports it.
export function locateProject(cwd) {
  const start = canonical(cwd || process.cwd());
  const configRoot = findConfigRoot(start);
  if (!configRoot) return null;
  const dirs = resolveGitDirs(configRoot) ?? { repoRoot: null, gitDir: null, commonDir: null };
  return { cwd: start, configRoot, configPath: join(configRoot, CONFIG_RELATIVE), ...dirs, stateDir: dirs.commonDir ? join(dirs.commonDir, 'dev-workflow') : null };
}

const listDir = (dir) => {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
};

// Everything the cached value is computed from: the config, the presets, every pack manifest a pack
// id can resolve to (bundled or project-local) and their directories, whose mtimes change when a pack
// is added or removed. plugin.json sits at another path after a plugin update.
export function cacheInputs(place) {
  const packDirs = [packsDir, join(place.configRoot, PROJECT_PACKS_DIR)];
  return [
    place.configPath,
    join(pluginRoot, '.claude-plugin', 'plugin.json'),
    presetsDir,
    ...listDir(presetsDir).map((name) => join(presetsDir, name)),
    ...packDirs,
    ...packDirs.flatMap((dir) => listDir(dir).map((name) => join(dir, name, 'pack.json'))),
  ];
}

// The workspace object of cli/lib/workspace.mjs loadWorkspace, built from the cached config, plus the
// active packs' guards. A broken config or pack throws (the hook then fails open and logs it).
export function loadHookWorkspace(place) {
  const { config, guards } = cachedByMtime(join(place.stateDir, CACHE_FILE), cacheInputs(place), () => {
    const loaded = loadConfig(place.configPath);
    return { config: loaded, guards: packGuards(resolvePacks({ configRoot: place.configRoot, config: loaded })) };
  });
  const mode = config.workspace.mode;
  const ws = {
    cwd: place.cwd,
    configRoot: place.configRoot,
    configPath: place.configPath,
    configDir: dirname(place.configPath),
    repoRoot: place.repoRoot,
    commonDir: place.commonDir,
    stateDir: place.stateDir,
    tasksDir: join(place.stateDir, 'tasks'),
    mode,
    appRoot: config.workspace.appRoot,
    workRepo: mode === 'in-place' ? join(place.configRoot, config.workspace.appRoot) : place.repoRoot,
    pluginRoot,
    config,
  };
  return { ws, guards };
}
