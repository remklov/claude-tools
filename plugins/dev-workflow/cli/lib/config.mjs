// Loads, validates and defaults .claude/dev-workflow/config.json (§5), merges the git preset, maps
// files to packages, and lists the values to mask in output.
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { globError } from './glob.mjs';
import { preconditionError } from './out.mjs';
import { singleTestTemplateError } from './packs.mjs';
import { presetsDir } from './paths.mjs';
import { loadSchema, validate } from './schema.mjs';

const lineColumn = (text, message) => {
  const position = /position (\d+)/.exec(message);
  if (!position) return '';
  const before = text.slice(0, Number(position[1]));
  const line = before.split('\n').length;
  return ` (line ${line}, column ${Number(position[1]) - before.lastIndexOf('\n')})`;
};

// Tickets are local Markdown files by default, one per key (ADR 0009).
export const DEFAULT_TICKET_SOURCE = 'local';
export const DEFAULT_LOCAL_TICKETS = 'docs/tickets/{key}.md';

// cw task return gives the implementer a fresh agent when its context is larger (ADR 0012).
export const DEFAULT_FRESH_IMPLEMENTER_ABOVE_TOKENS = 150_000;

export function readConfigFile(path) {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw preconditionError(`${path} is not valid JSON: ${error.message}${lineColumn(text, error.message)}`, 'Fix the JSON syntax, then run cw config validate.');
  }
}

export function loadPreset(name) {
  const path = join(presetsDir, `${name}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Normalizes a package path relative to the work repo: './x/' -> 'x', '.' stays '.'.
export function normalizePackagePath(path) {
  const clean = posix.normalize(String(path).replace(/\\/g, '/')).replace(/\/+$/, '');
  return clean === '' ? '.' : clean;
}

const isRelativeInside = (path) => {
  const clean = normalizePackagePath(path);
  return !clean.startsWith('/') && clean !== '..' && !clean.startsWith('../');
};

const packId = (entry) => (typeof entry === 'string' ? entry : entry?.id);

// Schema errors plus the cross-field rules, as { path, message }.
export function validateConfig(raw) {
  const errors = validate(loadSchema('config'), raw);
  if (errors.length) return errors;
  const add = (path, message) => errors.push({ path, message });

  const mode = raw.workspace?.mode ?? 'worktree';
  const appRoot = raw.workspace?.appRoot;
  if (mode === 'in-place') {
    if (appRoot === undefined) add('$.workspace.appRoot', 'is required for mode in-place');
    else if (!isRelativeInside(appRoot) || normalizePackagePath(appRoot) === '.') {
      add('$.workspace.appRoot', 'must be a relative path inside the project, not "." and without ".."');
    }
  } else if (appRoot !== undefined && normalizePackagePath(appRoot) !== '.') {
    add('$.workspace.appRoot', 'is only allowed with mode in-place');
  }

  const seen = { ids: new Set(), paths: new Set() };
  raw.packages.forEach((pkg, i) => {
    if (seen.ids.has(pkg.id)) add(`$.packages[${i}].id`, `duplicates package id "${pkg.id}"`);
    seen.ids.add(pkg.id);
    if (!isRelativeInside(pkg.path)) add(`$.packages[${i}].path`, 'must be relative to the work repo root, without a leading "/" or ".."');
    const path = normalizePackagePath(pkg.path);
    if (seen.paths.has(path)) add(`$.packages[${i}].path`, `duplicates package path "${path}"`);
    seen.paths.add(path);
    const testSingle = pkg.testSingle === undefined ? null : singleTestTemplateError(pkg.testSingle);
    if (testSingle) add(`$.packages[${i}].testSingle`, testSingle);
  });

  const packIds = new Set();
  raw.packs.forEach((entry, i) => {
    const id = packId(entry);
    if (packIds.has(id)) add(`$.packs[${i}]`, `duplicates pack "${id}"`);
    packIds.add(id);
  });

  const preset = raw.git?.preset ?? 'default';
  if (!loadPreset(preset)) add('$.git.preset', `names no preset (presets/git/${preset}.json is missing)`);

  const keyPattern = raw.tickets?.keyPattern;
  if (keyPattern !== undefined) {
    try {
      const compiled = new RegExp(keyPattern);
      const noTicketKey = raw.git?.noTicketKey;
      if (noTicketKey && compiled.test(noTicketKey)) add('$.git.noTicketKey', `must not match tickets.keyPattern (${keyPattern})`);
    } catch (error) {
      add('$.tickets.keyPattern', `is not a valid regular expression: ${error.message}`);
    }
  }

  const contextPath = raw.tickets?.contextPath;
  if (contextPath === undefined) {
    // Source local without a contextPath uses DEFAULT_LOCAL_TICKETS.
  } else if (!contextPath.includes('{key}')) {
    add('$.tickets.contextPath', 'must contain {key}, e.g. docs/specs/{key}.md');
  } else if (!isRelativeInside(contextPath)) {
    add('$.tickets.contextPath', 'must be a relative path inside the project, without a leading "/" or ".."');
  }

  (raw.complexity?.escalate ?? []).forEach((item, i) => {
    if (!item.paths && !item.keywords) add(`$.complexity.escalate[${i}]`, 'needs paths or keywords');
    (item.paths ?? []).forEach((glob, j) => {
      const problem = globError(glob);
      if (problem) add(`$.complexity.escalate[${i}].paths[${j}]`, problem);
    });
  });
  return errors;
}

export const formatConfigErrors = (errors) => errors.map((error) => `- ${error.path}: ${error.message}`).join('\n');

// The config with every default filled in, packs normalized with core first, and the preset merged.
export function withDefaults(raw) {
  const preset = loadPreset(raw.git?.preset ?? 'default');
  const repoLanguage = raw.project.language?.repo ?? 'en';
  const mode = raw.workspace?.mode ?? 'worktree';
  const packs = raw.packs.map((entry) => (typeof entry === 'string' ? { id: entry } : { ...entry }));
  return {
    version: 1,
    project: { name: raw.project.name, language: { repo: repoLanguage, productCopy: raw.project.language?.productCopy ?? repoLanguage } },
    workspace: { mode, appRoot: mode === 'in-place' ? normalizePackagePath(raw.workspace.appRoot) : '.' },
    packs: packs.some((pack) => pack.id === 'core') ? packs : [{ id: 'core' }, ...packs],
    packages: raw.packages.map((pkg) => ({ checks: {}, env: {}, ...pkg, path: normalizePackagePath(pkg.path) })),
    git: {
      preset: preset.id,
      defaultBase: raw.git?.defaultBase ?? 'main',
      noTicketKey: raw.git?.noTicketKey ?? preset.noTicketKey,
      host: raw.git?.host ?? null,
      conventions: preset,
    },
    tickets: {
      source: raw.tickets?.source ?? DEFAULT_TICKET_SOURCE,
      site: raw.tickets?.site ?? null,
      keyPattern: raw.tickets?.keyPattern ?? '^[A-Z][A-Z0-9]+-[0-9]+$',
      contextPath: raw.tickets?.contextPath ?? ((raw.tickets?.source ?? DEFAULT_TICKET_SOURCE) === 'local' ? DEFAULT_LOCAL_TICKETS : null),
    },
    workflow: {
      maxReviewRounds: raw.workflow?.maxReviewRounds ?? 3,
      confirm: raw.workflow?.confirm ?? ['l', 'xl'],
      maxQuestionsPerRound: raw.workflow?.maxQuestionsPerRound ?? 4,
      checkTimeoutMinutes: raw.workflow?.checkTimeoutMinutes ?? 15,
      // null (and 0) switch the rule off, so only a missing key takes the default.
      freshImplementerAboveTokens: raw.workflow?.freshImplementerAboveTokens === undefined ? DEFAULT_FRESH_IMPLEMENTER_ABOVE_TOKENS : raw.workflow.freshImplementerAboveTokens,
    },
    guards: { ports: raw.guards?.ports ?? [], commands: raw.guards?.commands ?? [], devServer: raw.guards?.devServer ?? 'allowed' },
    complexity: { escalate: raw.complexity?.escalate ?? [] },
    rules: {
      add: raw.rules?.add ?? [],
      disable: raw.rules?.disable ?? [],
      extend: raw.rules?.extend ?? {},
      override: raw.rules?.override ?? {},
      options: raw.rules?.options ?? {},
      allowProtected: raw.rules?.allowProtected ?? false,
    },
  };
}

export function loadConfig(path) {
  const raw = readConfigFile(path);
  const errors = validateConfig(raw);
  if (errors.length) {
    throw preconditionError(`The config ${path} is invalid:\n${formatConfigErrors(errors)}`, 'Correct these fields, then run cw config validate.', { errors });
  }
  return withDefaults(raw);
}

// Values that must never appear in output: the packages' env values (§8).
export const secretValues = (config) => config.packages.flatMap((pkg) => Object.values(pkg.env ?? {}));

// The package owning a work-repo-relative file: the longest matching path; '.' matches everything.
export function packageOf(config, file) {
  const path = normalizePackagePath(file);
  let best = null;
  for (const pkg of config.packages) {
    const matches = pkg.path === '.' || path === pkg.path || path.startsWith(`${pkg.path}/`);
    const length = pkg.path === '.' ? 0 : pkg.path.length;
    if (matches && (!best || length > best.length)) best = { pkg, length };
  }
  return best?.pkg ?? null;
}

// The packages owning files, in config order, plus the files no package owns.
export function packagesOf(config, files) {
  const owned = new Set();
  const unowned = [];
  for (const file of files) {
    const pkg = packageOf(config, file);
    if (pkg) owned.add(pkg.id);
    else unowned.push(file);
  }
  return { packages: config.packages.filter((pkg) => owned.has(pkg.id)), unowned };
}

export const packageById = (config, id) => config.packages.find((pkg) => pkg.id === id) ?? null;

