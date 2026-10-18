// Resolves stack packs (project-local first, then the plugin), their variants and options.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchGlob } from './glob.mjs';
import { CwError, warn } from './out.mjs';
import { packsDir } from './paths.mjs';
import { formatErrors, validateWith } from './schema.mjs';
import { render } from './template.mjs';

function locatePack(ctx, id) {
  const local = ctx ? join(ctx.workflowDir, 'packs', id) : null;
  if (local && existsSync(join(local, 'pack.json'))) {
    return { root: local, source: 'local', shadows: existsSync(join(packsDir, id, 'pack.json')) };
  }
  const bundled = join(packsDir, id);
  if (existsSync(join(bundled, 'pack.json'))) return { root: bundled, source: 'plugin', shadows: false };
  return null;
}

export function readPackManifest(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'pack.json'), 'utf8'));
  const errors = validateWith('pack', manifest);
  if (errors.length) throw new CwError(`Invalid pack manifest ${join(root, 'pack.json')}:\n${formatErrors(errors)}`);
  return manifest;
}

export function listAvailablePacks(ctx) {
  const ids = new Set(existsSync(packsDir) ? readdirSync(packsDir) : []);
  if (ctx && existsSync(join(ctx.workflowDir, 'packs'))) for (const id of readdirSync(join(ctx.workflowDir, 'packs'))) ids.add(id);
  return [...ids].filter((id) => locatePack(ctx, id)).sort();
}

function resolveOptions(manifest, given = {}) {
  const options = {};
  const errors = [];
  for (const [name, spec] of Object.entries(manifest.options ?? {})) {
    if (name in given) options[name] = given[name];
    else if ('default' in spec) options[name] = structuredClone(spec.default);
    else if (spec.required) errors.push(`option ${name} is required`);
  }
  for (const name of Object.keys(given)) {
    if (!(name in (manifest.options ?? {}))) errors.push(`unknown option ${name}`);
  }
  return { options, errors };
}

// Returns active packs in layering order: requirements first, then profile order.
export function resolvePacks(ctx, profile, { quiet = false } = {}) {
  const wanted = new Map(profile.packs.map((pack) => [pack.id, pack]));
  const ordered = [];
  const visiting = new Set();
  const errors = [];

  const visit = (id, requiredBy) => {
    if (ordered.some((pack) => pack.id === id)) return;
    if (visiting.has(id)) {
      errors.push(`circular requirement involving ${id}`);
      return;
    }
    const location = locatePack(ctx, id);
    if (!location) {
      errors.push(`pack ${id} not found${requiredBy ? ` (required by ${requiredBy})` : ''}`);
      return;
    }
    visiting.add(id);
    const manifest = readPackManifest(location.root);
    for (const requirement of manifest.requires ?? []) {
      if (!wanted.has(requirement) && !quiet) warn(`pack ${requirement} added because ${id} requires it`);
      visit(requirement, id);
    }
    visiting.delete(id);
    const entry = wanted.get(id) ?? { id };
    const variantNames = Object.keys(manifest.variants ?? {});
    const variant = entry.variant ?? manifest.defaultVariant ?? null;
    if (variant && !variantNames.includes(variant)) errors.push(`pack ${id}: unknown variant ${variant} (known: ${variantNames.join(', ')})`);
    if (!variant && variantNames.length) errors.push(`pack ${id}: choose a variant (${variantNames.join(', ')})`);
    const { options, errors: optionErrors } = resolveOptions(manifest, entry.options);
    errors.push(...optionErrors.map((error) => `pack ${id}: ${error}`));
    ordered.push({ id, root: location.root, source: location.source, shadows: location.shadows, manifest, variant, options, version: manifest.version });
  };

  for (const pack of profile.packs) visit(pack.id);
  for (const pack of ordered) {
    for (const conflict of pack.manifest.conflicts ?? []) {
      if (ordered.some((other) => other.id === conflict)) errors.push(`pack ${pack.id} conflicts with ${conflict}`);
    }
  }
  if (errors.length) throw new CwError(`Pack resolution failed:\n${errors.join('\n')}`);
  return ordered;
}

export const packById = (packs, id) => packs.find((pack) => pack.id === id);

// Replaces {options.x} in a string with the pack's option values (arrays joined by ", ").
export function withPackOptions(text, pack, extra = {}) {
  const values = { options: {}, ...extra };
  for (const [key, value] of Object.entries(pack.options)) values.options[key] = Array.isArray(value) ? value.join(', ') : value;
  return render(text, values);
}

export function packGuards(packs) {
  const guards = { commands: [], ports: [], dependencyCommands: [] };
  for (const pack of packs) {
    const g = pack.manifest.guards ?? {};
    guards.commands.push(...(g.commands ?? []).map((command) => withPackOptions(command, pack)));
    guards.ports.push(...(g.ports ?? []));
    guards.dependencyCommands.push(...(g.dependencyCommands ?? []));
    if (pack.id === 'docker') guards.commands.push(...(pack.options.runningStackCommands ?? []));
    if (pack.id === 'postgres-sql' && pack.options.devDatabasePort) guards.ports.push(pack.options.devDatabasePort);
  }
  return guards;
}

export function packComplexityRules(packs) {
  return packs.flatMap((pack) =>
    (pack.manifest.complexity ?? []).map((rule) => ({
      ...rule,
      paths: (rule.paths ?? []).map((path) => withPackOptions(path, pack)),
      reason: rule.reason ?? `pack ${pack.id}`,
    })),
  );
}

export function packScript(packs, reference) {
  const [id, name] = reference.split(':');
  const pack = packById(packs, id);
  if (!pack) throw new CwError(`Pack ${id} is not active in this project.`);
  const file = pack.manifest.scripts?.[name];
  if (!file) throw new CwError(`Pack ${id} has no script ${name} (has: ${Object.keys(pack.manifest.scripts ?? {}).join(', ') || 'none'}).`);
  return { pack, path: join(pack.root, file) };
}

export function testRunnerTemplate(packs) {
  for (const pack of [...packs].reverse()) if (pack.manifest.testRunner?.single) return pack.manifest.testRunner;
  return null;
}

// --- detection (cw init) ---

function readDependencies(repoRoot, dirs) {
  const deps = new Map();
  for (const dir of dirs) {
    try {
      const manifest = JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf8'));
      for (const [name, range] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
        if (!deps.has(name)) deps.set(name, range);
      }
    } catch {
      // No package.json here.
    }
  }
  return deps;
}

export function detectPacks(ctx, { files, packageDirs, remote = '' }) {
  const dependencies = readDependencies(ctx.repoRoot, ['.', ...packageDirs]);
  const found = [];
  for (const id of listAvailablePacks(ctx)) {
    const location = locatePack(ctx, id);
    const manifest = readPackManifest(location.root);
    const hit = (rule) => {
      if (rule.glob) return files.some((file) => matchGlob(file, rule.glob));
      if (rule.dependency) return dependencies.has(rule.dependency);
      if (rule.file) {
        if (!files.includes(rule.file)) return false;
        if (!rule.contains) return true;
        return readFileSync(join(ctx.repoRoot, rule.file), 'utf8').includes(rule.contains);
      }
      if (rule.remote) return new RegExp(rule.remote).test(remote);
      return false;
    };
    if (!(manifest.detect ?? []).some(hit)) continue;
    let variant = null;
    for (const [name, spec] of Object.entries(manifest.variants ?? {})) {
      const detects = spec.detect ?? [];
      const matches = detects.some((rule) => {
        if (rule.dependency && rule.major) {
          const range = dependencies.get(rule.dependency) ?? '';
          return new RegExp(`^[\\^~>=\\s]*${rule.major}(\\.|$)`).test(range);
        }
        return hit(rule);
      });
      if (matches) {
        variant = name;
        break;
      }
    }
    found.push({ id, variant: variant ?? manifest.defaultVariant ?? null, areas: manifest.areas ?? [] });
  }
  return found;
}
