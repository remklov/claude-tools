// Loads the project profile, validates it and fills in defaults.
import { readFileSync } from 'node:fs';
import { expandHome } from './ctx.mjs';
import { remoteUrl } from './git.mjs';
import { CwError } from './out.mjs';
import { formatErrors, validateWith } from './schema.mjs';

export const COMPLEXITIES = ['s', 'm', 'l', 'xl'];
export const complexityRank = (value) => COMPLEXITIES.indexOf(value);
export const maxComplexity = (a, b) => (complexityRank(a) >= complexityRank(b) ? a : b);

export function readProfileFile(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CwError(`Cannot read the profile ${path}: ${error.message}`);
  }
  return raw;
}

export function validateProfile(raw) {
  const errors = validateWith('profile', raw);
  const ids = new Set();
  for (const pkg of raw.packages ?? []) {
    if (ids.has(pkg.id)) errors.push({ path: `$.packages`, message: `duplicate package id ${pkg.id}` });
    ids.add(pkg.id);
    for (const other of pkg.alsoCheck ?? []) {
      if (!(raw.packages ?? []).some((candidate) => candidate.id === other)) {
        errors.push({ path: `$.packages.${pkg.id}.alsoCheck`, message: `unknown package ${other}` });
      }
    }
    for (const service of pkg.services ?? []) {
      if (!raw.services?.[service]) errors.push({ path: `$.packages.${pkg.id}.services`, message: `unknown service ${service}` });
    }
  }
  const packIds = (raw.packs ?? []).map((pack) => (typeof pack === 'string' ? pack : pack.id));
  if (new Set(packIds).size !== packIds.length) errors.push({ path: '$.packs', message: 'duplicate pack' });
  if (raw.tickets?.adapter === 'markdown-table' && !raw.tickets.file) errors.push({ path: '$.tickets.file', message: 'is required for markdown-table' });
  return errors;
}

export function withDefaults(raw, ctx) {
  const profile = structuredClone(raw);
  profile.project.language = { repo: 'en', ...profile.project.language };
  profile.project.language.productCopy ??= profile.project.language.repo;
  profile.packs = profile.packs.map((pack) => (typeof pack === 'string' ? { id: pack } : pack));
  if (!profile.packs.some((pack) => pack.id === 'core')) profile.packs.unshift({ id: 'core' });
  profile.packages = profile.packages.map((pkg) => ({
    docs: [], checks: {}, env: {}, services: [], exclusive: [], alsoCheck: [],
    ...pkg,
    paths: [].concat(pkg.path).map((path) => path.replace(/^\.\/|\/$/g, '') || '.'),
  }));
  profile.services ??= {};
  profile.complexity = { escalate: [], ...profile.complexity };
  profile.split = { mode: 'builds-on', order: profile.packages.map((pkg) => pkg.id), threshold: 'l', ...profile.split };
  profile.isolation = { mode: 'worktree', appRoot: '.', symlink: [], ...profile.isolation };
  profile.isolation.protectedCheckout = expandHome(profile.isolation.protectedCheckout) ?? ctx?.mainCheckout;
  profile.guards = { ports: [], commands: [], writePaths: ['.env', '.env.*', '**/.env', '**/.env.*', '**/*.pem', '**/*.key'], devServer: 'allowed', ...profile.guards };
  const url = ctx ? remoteUrl(ctx.repoRoot) ?? '' : '';
  profile.git = {
    host: /github\.com/.test(url) ? 'github' : /gitlab/.test(url) ? 'gitlab' : 'none',
    defaultBase: 'main',
    branchTypes: [],
    commitSummaryNoTicket: '{summary}',
    keywords: [],
    flags: [],
    commitTrailers: [],
    summaryMax: 72,
    bodyWrap: 72,
    noTicketKey: 'NO-TICKET',
    ...profile.git,
  };
  profile.git.branchNoTicket ??= profile.git.branch;
  profile.git.pr = {
    sections: [
      { title: 'What & why', source: 'spec.summary' },
      { title: 'Testing', source: 'checks' },
      { title: 'Risks & deploy steps', source: 'migrations' },
      { title: 'Open points', source: 'openPoints' },
    ],
    neverMerge: true,
    draft: false,
    ...profile.git.pr,
  };
  profile.tickets = { adapter: 'none', ...profile.tickets };
  profile.tickets.columns = { id: 'ID', status: 'Status', ...profile.tickets.columns };
  profile.tickets.statusOpen ??= '⬜ Open';
  profile.tickets.dependsColumn ??= 'Needs';
  profile.tickets.idPattern ??= profile.tickets.adapter === 'github-issues' ? '^#?[0-9]+$' : '^[A-Z]+-[0-9]+[a-z]?$';
  profile.tickets.newRowSections ??= {};
  profile.tickets.claims = {
    backend: url ? 'git-ref' : 'local',
    remote: 'origin',
    namespace: 'refs/claims',
    idNamespace: 'refs/ticket-ids',
    staleHours: 24,
    mergeDriver: true,
    ...profile.tickets.claims,
  };
  profile.knowledgeBase ??= {};
  profile.domain = { neverGuess: [], ...profile.domain };
  profile.workflow = {
    maxReviewRounds: 3,
    confirm: ['l', 'xl'],
    maxQuestionsPerRound: 4,
    checkTimeoutMinutes: 15,
    agentPrefix: 'dev-workflow:',
    ...profile.workflow,
  };
  profile.rules = { disable: [], override: {}, extend: {}, add: [], options: {}, aliases: {}, allowProtected: false, ...profile.rules };
  return profile;
}

export function loadProfile(ctx) {
  const raw = readProfileFile(ctx.profilePath);
  const errors = validateProfile(raw);
  if (errors.length) throw new CwError(`The profile ${ctx.profilePath} is invalid:\n${formatErrors(errors)}`, { details: errors });
  return withDefaults(raw, ctx);
}

// The package owning a repo-relative file: longest matching path prefix.
export function packageOf(profile, file) {
  let best = null;
  let bestLength = -1;
  for (const pkg of profile.packages) {
    for (const path of pkg.paths) {
      const matches = path === '.' || file === path || file.startsWith(`${path}/`);
      const length = path === '.' ? 0 : path.length;
      if (matches && length > bestLength) {
        best = pkg;
        bestLength = length;
      }
    }
  }
  return best;
}

export function packagesOf(profile, files) {
  const byId = new Map();
  const unowned = [];
  for (const file of files) {
    const pkg = packageOf(profile, file);
    if (pkg) byId.set(pkg.id, pkg);
    else unowned.push(file);
  }
  return { packages: profile.packages.filter((pkg) => byId.has(pkg.id)), unowned };
}

export const packageById = (profile, id) => profile.packages.find((pkg) => pkg.id === id);
