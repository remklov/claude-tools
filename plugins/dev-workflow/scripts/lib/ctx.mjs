// Discovery of the repository, the git common dir, the main checkout and the workflow directories.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { tryGit } from './git.mjs';
import { preconditionError } from './out.mjs';
import { pluginRoot } from './paths.mjs';

export const expandHome = (path) => (path?.startsWith('~') ? join(homedir(), path.slice(1)) : path);

export function findContext(cwd = process.cwd()) {
  const repoRoot = tryGit(['rev-parse', '--show-toplevel'], { cwd });
  if (!repoRoot) return null;
  let commonDir = tryGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
  if (commonDir && !isAbsolute(commonDir)) commonDir = resolve(cwd, commonDir);
  const gitDir = tryGit(['rev-parse', '--path-format=absolute', '--git-dir'], { cwd });
  const mainCheckout = basename(commonDir) === '.git' ? dirname(commonDir) : repoRoot;
  // A worktree created before the profile was committed falls back to the main checkout's profile.
  const ownProfile = join(repoRoot, '.claude', 'workflow', 'profile.json');
  const configRoot = existsSync(ownProfile) || !existsSync(join(mainCheckout, '.claude', 'workflow', 'profile.json')) ? repoRoot : mainCheckout;
  const profilePath = join(configRoot, '.claude', 'workflow', 'profile.json');
  return {
    cwd,
    repoRoot,
    commonDir,
    gitDir,
    mainCheckout,
    isLinkedWorktree: gitDir !== commonDir,
    pluginRoot,
    profilePath,
    hasProfile: existsSync(profilePath),
    stateDir: join(commonDir, 'dev-workflow'),
    configRoot,
    workflowDir: join(configRoot, '.claude', 'workflow'),
  };
}

export function requireContext(cwd) {
  const ctx = findContext(cwd);
  if (!ctx) throw preconditionError('Not inside a git repository.');
  return ctx;
}

export function requireProfileContext(cwd) {
  const ctx = requireContext(cwd);
  if (!ctx.hasProfile) {
    throw preconditionError(`No workflow profile at ${ctx.profilePath}. Run /dev-workflow:setup (or cw init --detect) first.`);
  }
  return ctx;
}
