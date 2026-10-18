// Environment checks (spec 02 §3 cw doctor), cached for 12 h.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gitVersion, tryGit } from './git.mjs';
import { pluginVersion } from './paths.mjs';
import { run } from './proc.mjs';
import { loadProfile } from './profile.mjs';
import { resolvePacks } from './packs.mjs';
import { buildRulebook, diffRulebook } from './rules.mjs';
import { readJson, writeJson } from './fsx.mjs';

const MIN_CLAUDE = [2, 1, 300];
const CONFLICTING_PLUGINS = [/^savvy-(progress|flow)@/];

const versionAtLeast = (actual, wanted) => {
  for (let i = 0; i < wanted.length; i += 1) {
    if ((actual[i] ?? 0) !== wanted[i]) return (actual[i] ?? 0) > wanted[i];
  }
  return true;
};

function enabledPlugins(ctx) {
  const files = [join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json'), join(ctx.repoRoot, '.claude', 'settings.json'), join(ctx.repoRoot, '.claude', 'settings.local.json')];
  const enabled = new Set();
  for (const file of files) for (const [id, on] of Object.entries(readJson(file, {}).enabledPlugins ?? {})) if (on) enabled.add(id);
  return enabled;
}

export function runDoctor(ctx) {
  const results = [];
  const add = (id, level, ok, message) => results.push({ id, level, ok, message });
  const claude = run('claude', ['--version'], { timeoutMs: 10_000 });
  if (claude.code === 0) {
    const version = (/(\d+)\.(\d+)\.(\d+)/.exec(claude.stdout) ?? []).slice(1).map(Number);
    add('claude-version', 'error', versionAtLeast(version, MIN_CLAUDE), `Claude Code ${version.join('.')} (need ≥ ${MIN_CLAUDE.join('.')})`);
  }
  const node = process.versions.node.split('.').map(Number);
  add('node', 'error', node[0] >= 20, `Node ${process.versions.node} (need ≥ 20)`);
  const gitV = gitVersion();
  add('git', 'error', versionAtLeast(gitV, [2, 38]), `git ${gitV.join('.')} (need ≥ 2.38 for merge-tree --write-tree)`);
  let profile = null;
  let packs = null;
  try {
    profile = loadProfile(ctx);
    packs = resolvePacks(ctx, profile, { quiet: true });
    add('profile', 'error', true, `profile valid, packs: ${packs.map((pack) => pack.id + (pack.variant ? `@${pack.variant}` : '')).join(', ')}`);
    for (const pack of packs.filter((p) => p.shadows)) add(`pack-${pack.id}`, 'warning', false, `local pack ${pack.id} shadows the plugin's pack`);
  } catch (error) {
    add('profile', 'error', false, error.message);
  }
  if (profile && packs) {
    try {
      const book = buildRulebook(ctx, profile, packs);
      const diff = diffRulebook(ctx, book, readFileSync(ctx.profilePath, 'utf8'));
      add('rulebook', 'warning', diff.isCurrent, diff.isCurrent ? 'rulebook up to date' : `rulebook out of date (${diff.problems.slice(0, 6).join('; ')}). Run: cw rules build`);
    } catch (error) {
      add('rulebook', 'error', false, `rulebook cannot be built: ${error.message}`);
    }
    for (const dir of profile.isolation.symlink) {
      add(`symlink-${dir}`, 'warning', existsSync(join(ctx.mainCheckout, dir)), `${dir} ${existsSync(join(ctx.mainCheckout, dir)) ? 'exists' : 'is missing'} in the main checkout (worktrees link it)`);
    }
    for (const [id, service] of Object.entries(profile.services)) {
      const isUp = run('sh', ['-c', service.check], { cwd: ctx.repoRoot, timeoutMs: 15_000 }).code === 0;
      add(`service-${id}`, 'warning', isUp || Boolean(service.start), `service ${id} ${isUp ? 'is up' : service.start ? 'is down (cw checks starts it)' : 'is down and has no start command'}`);
    }
    if (profile.tickets.claims.backend === 'git-ref') {
      const reachable = run('git', ['ls-remote', profile.tickets.claims.remote, `${profile.tickets.claims.namespace}/*`], { cwd: ctx.repoRoot, timeoutMs: 20_000 }).code === 0;
      add('claims-remote', 'warning', reachable, reachable ? `claims remote ${profile.tickets.claims.remote} reachable` : `claims remote ${profile.tickets.claims.remote} unreachable (claims fall back to this machine)`);
    }
    if (profile.tickets.adapter === 'markdown-table' && profile.tickets.claims.mergeDriver) {
      const driver = tryGit(['config', '--get', 'merge.dw-ticket-table.driver'], { cwd: ctx.repoRoot });
      add('merge-driver', 'warning', Boolean(driver), driver ? 'backlog merge driver registered' : 'backlog merge driver not registered in this clone: run cw init --merge-driver');
    }
    for (const pack of packs) {
      for (const check of pack.manifest.doctor ?? []) {
        const outcome = run('node', [join(pack.root, check.script)], {
          cwd: ctx.repoRoot,
          env: { CW_REPO_ROOT: ctx.repoRoot, CW_PROFILE: ctx.profilePath, CW_PACK_OPTIONS: JSON.stringify(pack.options) },
          timeoutMs: 20_000,
        });
        add(`${pack.id}:${check.id}`, 'warning', outcome.code === 0, outcome.stdout.trim() || outcome.stderr.trim() || check.description);
      }
    }
  }
  if (process.platform === 'darwin') {
    const settings = readJson(join(homedir(), '.claude', 'settings.json'), {});
    const ok = settings.sandbox?.network?.allowLocalBinding === true;
    add('sandbox-local-binding', 'warning', ok, ok ? 'sandbox allows local binding' : 'set sandbox.network.allowLocalBinding: true in ~/.claude/settings.json, or API tests and dev servers fail with EPERM in the sandbox');
  }
  const conflicts = [...enabledPlugins(ctx)].filter((id) => CONFLICTING_PLUGINS.some((pattern) => pattern.test(id)));
  add('conflicting-plugins', 'warning', conflicts.length === 0, conflicts.length ? `disable conflicting plugins: ${conflicts.join(', ')}` : 'no conflicting plugins');
  return results;
}

export function doctorCached(ctx, { fresh = false } = {}) {
  const cacheFile = join(ctx.stateDir, 'doctor-cache.json');
  const profileText = existsSync(ctx.profilePath) ? readFileSync(ctx.profilePath, 'utf8') : '';
  const key = createHash('sha256').update(`${profileText}|${pluginVersion()}|${process.version}`).digest('hex');
  const cache = readJson(cacheFile, null);
  if (!fresh && cache?.key === key && Date.now() - cache.at < 12 * 3600_000) return { results: cache.results, cached: true, reported: cache.reported ?? [] };
  const results = runDoctor(ctx);
  writeJson(cacheFile, { key, at: Date.now(), results, reported: cache?.reported ?? [] });
  return { results, cached: false, reported: cache?.reported ?? [] };
}

export function markReported(ctx, ids) {
  const cacheFile = join(ctx.stateDir, 'doctor-cache.json');
  const cache = readJson(cacheFile, null);
  if (cache) writeJson(cacheFile, { ...cache, reported: ids });
}
