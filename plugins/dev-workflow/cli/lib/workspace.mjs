// Workspace discovery (D5): the config root is the nearest ancestor of the cwd with
// .claude/dev-workflow/config.json, also across nested git roots; the task state lives in the config
// root's git common dir; all git and check operations target the work repo (appRoot or the task's
// worktree), never the cwd.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from './config.mjs';
import { quote } from './host/index.mjs';
import { preconditionError } from './out.mjs';
import { pluginRoot } from './paths.mjs';
import { run } from './proc.mjs';

export const CONFIG_RELATIVE = join('.claude', 'dev-workflow', 'config.json');

export function findConfigRoot(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, CONFIG_RELATIVE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The git dirs of the repository containing dir, read from the file system: a .git directory, or a
// .git file "gitdir: <path>" whose commondir names the main repository's .git (linked worktrees).
export function resolveGitDirs(dir) {
  let current = resolve(dir);
  for (;;) {
    const dotGit = join(current, '.git');
    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) return { repoRoot: current, gitDir: dotGit, commonDir: dotGit };
      const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
      if (match) {
        const gitDir = resolve(current, match[1].trim());
        const commonFile = join(gitDir, 'commondir');
        const commonDir = existsSync(commonFile) ? resolve(gitDir, readFileSync(commonFile, 'utf8').trim()) : gitDir;
        return { repoRoot: current, gitDir, commonDir };
      }
      break;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const result = run('git', ['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir'], { cwd: dir });
  if (result.code !== 0) return null;
  const [repoRoot, gitDir, commonDir] = result.stdout.trim().split('\n');
  const absolute = (path) => (isAbsolute(path) ? path : resolve(dir, path));
  return { repoRoot, gitDir: absolute(gitDir), commonDir: absolute(commonDir) };
}

// Most often cw simply ran outside the project; setting a project up is the second case.
export const NO_CONFIG_FIX = `Run cw in the project directory or below it, where ${CONFIG_RELATIVE} is. To set up a project without one, run setup.sh in its root, or cw init --interactive in a terminal.`;

// The workspace for a cwd. Without a config: null when requireConfig is false, else exit 3.
// Paths are canonical (symlinks resolved), so task.json, state.json and the hooks agree on them.
export function loadWorkspace({ cwd: givenCwd, requireConfig = true } = {}) {
  const cwd = existsSync(givenCwd) ? realpathSync(givenCwd) : resolve(givenCwd);
  const configRoot = findConfigRoot(cwd);
  if (!configRoot) {
    if (!requireConfig) return null;
    throw preconditionError(
      `No ${CONFIG_RELATIVE} in ${cwd} or any parent directory.`,
      NO_CONFIG_FIX,
    );
  }
  const dirs = resolveGitDirs(configRoot);
  if (!dirs) {
    throw preconditionError(
      `${configRoot} is not inside a git repository; the task state lives in its .git/dev-workflow/.`,
      'Run cw in a project whose root is a git repository.',
    );
  }
  const configPath = join(configRoot, CONFIG_RELATIVE);
  const config = loadConfig(configPath);
  const mode = config.workspace.mode;
  const stateDir = join(dirs.commonDir, 'dev-workflow');
  return {
    cwd,
    configRoot,
    configPath,
    configDir: dirname(configPath),
    repoRoot: dirs.repoRoot,
    commonDir: dirs.commonDir,
    stateDir,
    tasksDir: join(stateDir, 'tasks'),
    mode,
    appRoot: config.workspace.appRoot,
    workRepo: mode === 'in-place' ? join(configRoot, config.workspace.appRoot) : dirs.repoRoot,
    pluginRoot,
    config,
  };
}

// The work tree of a task: its worktree, or the app root in in-place mode; null before ws setup.
export const workTreeOf = (ws, task) => task?.workTree ?? (ws.mode === 'in-place' ? ws.workRepo : null);

// The git form of the commands cw prints for the implementer and in fix texts (D5, §6 implementer step 6).
// In-place: git -C <appRoot>, relative to the project root, where the Bash cwd stays (owner decision
// 2026-10-20), so the allow rules cw init writes for git -C <appRoot> add|commit match it (§12). Worktree
// mode: plain git inside the agent's worktree.
// cw context, the brief, the fix texts, cw pr command and the SubagentStart context all print this form.
export const gitForm = (ws) => (ws.mode === 'in-place' ? `git -C ${quote(ws.config.workspace.appRoot)}` : 'git');

// In-place, for a Bash cwd other than the project root: the git -C <appRoot> form names another
// directory from there. It says what to use instead and claims nothing about other git forms. null
// at the project root and in worktree mode.
export function gitCwdNote(ws, cwd = ws.cwd) {
  if (ws.mode !== 'in-place' || cwd === ws.configRoot) return null;
  return `the cwd ${cwd} is not the project root ${ws.configRoot}, and the ${gitForm(ws)} … commands are relative to the project root, so from this cwd they name another directory. Use git -C ${quote(ws.workRepo)} … instead (it may ask for permission).`;
}

// Where orchestrator-side git commands run for a task (base checks, foreign commits, PR commands).
export const orchestratorTreeOf = (ws, task) => (ws.mode === 'in-place' ? ws.workRepo : (task?.workTree ?? ws.repoRoot));

export const taskDir = (ws, id) => join(ws.tasksDir, id);
export const taskPath = (ws, id, name) => join(ws.tasksDir, id, name);
