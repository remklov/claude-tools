// cw init: detect the stack and propose a profile; write profile, settings, gitignore, gitattributes
// and the instruction snippet. Never reads or writes .claude/settings.local.json.
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { git, lines, remoteUrl, tryGit } from './git.mjs';
import { CwError } from './out.mjs';
import { detectPacks, readPackManifest, resolvePacks } from './packs.mjs';
import { templatesDir } from './paths.mjs';
import { run } from './proc.mjs';
import { readJson, writeAtomic, writeJson } from './fsx.mjs';

const AREA_HINTS = [
  [/(^|[-_/])(app|web|frontend|ui|client)$/, 'frontend'],
  [/(^|[-_/])(api|server|backend|service|signer|worker)$/, 'backend'],
  [/(^|[-_/])(infra|deploy|docker|ops)$/, 'infra'],
  [/(^|[-_/])(shared|common|lib|packages)$/, 'shared'],
  [/(^|[-_/])(docs?|plan)$/, 'docs'],
];

function packageDirs(repoRoot, files) {
  const dirs = new Set();
  const root = readJson(join(repoRoot, 'package.json'), null);
  for (const pattern of [].concat(root?.workspaces?.packages ?? root?.workspaces ?? [])) {
    if (!pattern.includes('*')) dirs.add(pattern.replace(/\/$/, ''));
  }
  for (const file of files) {
    const parts = file.split('/');
    if (parts.length <= 3 && ['package.json', 'pyproject.toml', 'composer.json', 'go.mod', 'Cargo.toml'].includes(parts.at(-1))) {
      const dir = parts.slice(0, -1).join('/');
      if (dir && !dir.includes('node_modules')) dirs.add(dir);
    }
  }
  return [...dirs].sort();
}

export function detect(ctx) {
  const files = lines(git(['ls-files'], { cwd: ctx.repoRoot }));
  const dirs = packageDirs(ctx.repoRoot, files);
  const packs = detectPacks(ctx, { files, packageDirs: dirs, remote: remoteUrl(ctx.repoRoot) ?? '' });
  const discovery = {};
  for (const found of packs) {
    const manifest = readPackManifest(join(ctx.pluginRoot, 'packs', found.id));
    if (!manifest.checkDiscovery) continue;
    const out = run('node', [join(ctx.pluginRoot, 'packs', found.id, manifest.checkDiscovery)], {
      cwd: ctx.repoRoot, env: { CW_REPO_ROOT: ctx.repoRoot, CW_PACKAGE_DIRS: JSON.stringify(dirs.length ? dirs : ['.']) },
    });
    if (out.code === 0) Object.assign(discovery, JSON.parse(out.stdout || '{}'));
  }
  const packages = (dirs.length ? dirs : ['.']).map((dir) => {
    const name = basename(dir === '.' ? ctx.repoRoot : dir);
    const area = AREA_HINTS.find(([pattern]) => pattern.test(name))?.[1] ?? 'backend';
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
    return { id, path: dir, areas: [area], checks: discovery[dir] ?? {} };
  });
  if (files.some((file) => file.startsWith('.github/workflows/'))) packages.push({ id: 'ci', path: '.github/workflows', areas: ['infra'] });
  const url = remoteUrl(ctx.repoRoot) ?? '';
  const nodeModules = ['node_modules', ...dirs.map((dir) => `${dir}/node_modules`)].filter((dir) => existsSync(join(ctx.repoRoot, dir)));
  const ticketFile = files.find((file) => /(^|\/)(NEXT_STEPS|BACKLOG|TODO)\.md$/i.test(file));
  const profile = {
    $schema: 'https://raw.githubusercontent.com/remklov/claude-tools/main/plugins/dev-workflow/schemas/profile.schema.json',
    version: 1,
    project: { name: basename(ctx.repoRoot), language: { repo: 'en' } },
    packs: ['core', ...packs.filter((pack) => pack.id !== 'core').map((pack) => (pack.variant ? { id: pack.id, variant: pack.variant } : pack.id))],
    packages,
    isolation: { mode: 'worktree', symlink: nodeModules },
    git: { host: /github\.com/.test(url) ? 'github' : /gitlab/.test(url) ? 'gitlab' : 'none', defaultBase: tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: ctx.repoRoot })?.replace('origin/', '') ?? 'main', branch: '{ticket|lower}-{slug}', branchNoTicket: 'chore-{slug}', commitSummary: '{summary} ({ticket})' },
    tickets: ticketFile ? { adapter: 'markdown-table', file: ticketFile } : { adapter: /github\.com/.test(url) ? 'github-issues' : 'none' },
  };
  const questions = [
    'Ticket source: confirm the adapter and file (markdown-table, github-issues, none).',
    'Git conventions: branch template, commit summary template, keywords and trailers.',
    'Package areas and checks: confirm each package (areas drive rules and procedures).',
    'Guards: ports, commands and dev-server policy that agents must never touch.',
    'Services the checks need (test databases) and how to start them.',
    'Topics where agents must never guess (domain.neverGuess).',
  ];
  return { profile, detectedPacks: packs, questions };
}

const union = (a = [], b = []) => [...new Set([...a, ...b])];

export function mergeSettings(existing, fragment) {
  const merged = structuredClone(existing);
  const conflicts = [];
  const walk = (target, source, path) => {
    for (const [key, value] of Object.entries(source)) {
      const here = `${path}${key}`;
      if (Array.isArray(value)) target[key] = union(target[key], value);
      else if (value && typeof value === 'object') {
        if (target[key] !== undefined && (typeof target[key] !== 'object' || Array.isArray(target[key]))) conflicts.push(here);
        else walk((target[key] ??= {}), value, `${here}.`);
      } else if (target[key] === undefined) target[key] = value;
      else if (target[key] !== value) conflicts.push(`${here} (kept ${JSON.stringify(target[key])}, proposed ${JSON.stringify(value)})`);
    }
  };
  walk(merged, fragment, '');
  return { merged, conflicts };
}

export function settingsFragment(ctx, profile, packs) {
  const allow = new Set(['Bash(cw *)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git branch -m *)']);
  const ask = new Set(['Bash(git push *)']);
  const deny = new Set(['Agent(model:*)', 'Agent(effort:*)']);
  for (const pack of packs) {
    for (const rule of pack.manifest.settings?.allow ?? []) allow.add(rule);
    for (const rule of pack.manifest.settings?.ask ?? []) ask.add(rule);
    for (const rule of pack.manifest.settings?.deny ?? []) deny.add(rule);
  }
  for (const pkg of profile.packages) for (const command of Object.values(pkg.checks)) {
    if (/^npm (test|run [\w:-]+)$/.test(command)) allow.add(`Bash(${command} *)`);
  }
  return {
    extraKnownMarketplaces: { remklov: { source: { source: 'github', repo: 'remklov/claude-tools' } } },
    enabledPlugins: { 'dev-workflow@remklov': true, 'agents-progress@remklov': true },
    permissions: { allow: [...allow], deny: [...deny], ask: [...ask] },
    worktree: { baseRef: 'head', symlinkDirectories: profile.isolation.symlink },
    env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1' },
  };
}

export function updateGitignore(ctx) {
  const path = join(ctx.repoRoot, '.gitignore');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (!/^\.claude\/\*\s*$/m.test(text) || /^!\.claude\/workflow\/?\s*$/m.test(text)) return false;
  const lines_ = text.split('\n');
  const lastAllow = lines_.reduce((last, line, i) => (line.startsWith('!.claude/') ? i : last), lines_.findIndex((line) => /^\.claude\/\*/.test(line)));
  lines_.splice(lastAllow + 1, 0, '!.claude/workflow/');
  writeAtomic(path, lines_.join('\n'));
  return true;
}

export function registerMergeDriver(ctx, profile) {
  if (profile.tickets.adapter !== 'markdown-table' || !profile.tickets.claims.mergeDriver) return false;
  const path = join(ctx.repoRoot, '.gitattributes');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const line = `${profile.tickets.file} merge=dw-ticket-table`;
  if (!text.includes(line)) {
    writeAtomic(path, `${text.replace(/\n*$/, text ? '\n' : '')}# Backlog rows merge by ticket ID (dev-workflow); driver registered by \`cw init\`.\n${line}\n`);
  }
  git(['config', 'merge.dw-ticket-table.name', 'dev-workflow backlog rows by ticket ID'], { cwd: ctx.repoRoot });
  git(['config', 'merge.dw-ticket-table.driver', 'cw merge-driver ticket-table %O %A %B'], { cwd: ctx.repoRoot });
  return true;
}

export function writeSnippet(ctx) {
  const claude = join(ctx.repoRoot, 'CLAUDE.md');
  const agents = join(ctx.repoRoot, 'AGENTS.md');
  const useAgents = existsSync(agents) && (!existsSync(claude) || (lstatSync(claude).isSymbolicLink() && realpathSync(claude) === realpathSync(agents)));
  const target = useAgents ? agents : claude;
  const snippet = readFileSync(join(templatesDir, 'claude-md-snippet.md'), 'utf8').trim();
  const block = `<!-- dev-workflow:start -->\n${snippet}\n<!-- dev-workflow:end -->`;
  const text = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const updated = /<!-- dev-workflow:start -->[\s\S]*?<!-- dev-workflow:end -->/.test(text)
    ? text.replace(/<!-- dev-workflow:start -->[\s\S]*?<!-- dev-workflow:end -->/, block)
    : `${text.replace(/\n*$/, text ? '\n\n' : '')}## Agent workflow\n\n${block}\n`;
  writeAtomic(target, updated);
  return target;
}

export function writeProfile(ctx, profile, { overwrite = false } = {}) {
  if (existsSync(ctx.profilePath) && !overwrite) throw new CwError(`${ctx.profilePath} exists; pass --yes to overwrite.`);
  writeJson(ctx.profilePath, profile);
}

export function writeSettings(ctx, fragment) {
  const path = join(ctx.repoRoot, '.claude', 'settings.json');
  const { merged, conflicts } = mergeSettings(readJson(path, {}), fragment);
  writeJson(path, merged);
  return { path, conflicts };
}

export { resolvePacks };
