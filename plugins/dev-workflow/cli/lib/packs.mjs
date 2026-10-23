// Stack packs (§7): resolves the active packs (core first, requires, variants, typed options), reads
// the pack data other areas need (test runner, guards, settings, complexity escalations, review scope
// scripts, detection for cw init), runs pack scripts, and loads and selects role procedures (§6).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { globError, matchAny, matchGlob } from './glob.mjs';
import { CwError, failedError, preconditionError, usageError } from './out.mjs';
import { packsDir } from './paths.mjs';
import { run } from './proc.mjs';
import { loadSchema, validate } from './schema.mjs';

export const ROLES = ['orchestrator', 'implementer', 'reviewer'];
export const PROJECT_PACKS_DIR = join('.claude', 'dev-workflow', 'packs');
export const PROJECT_PROCEDURES_DIR = join('.claude', 'dev-workflow', 'procedures');
export const SCRIPT_TIMEOUT_MS = 600_000;

const CONFIG_FILE = '.claude/dev-workflow/config.json';

// ---- placeholders ({options.x}, {ruleOptions.x}, {project.x}; §7) ----

// Only these namespaces are placeholders, so rule texts may contain literal braces like '/items{/:id}'.
export const PLACEHOLDER = /\{(options|ruleOptions|project)((?:\.[A-Za-z0-9_]+)+)\}/g;
// A token of those namespaces that PLACEHOLDER can't read, such as {ruleOptions.max-items}.
const PLACEHOLDER_LIKE = /\{(?:options|ruleOptions|project)\.[^{}\s]*\}/g;
const PLACEHOLDER_EXACT = new RegExp(`^${PLACEHOLDER.source}$`);

const display = (value) => {
  if (Array.isArray(value)) return value.join(', ');
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

// One pass, so a substituted value is never scanned again; returns the tokens left unresolved and the
// invalid ones (a name PLACEHOLDER can't read), which would otherwise stay in the text unnoticed.
export function resolvePlaceholders(text, values) {
  const unresolved = [];
  const invalid = (String(text).match(PLACEHOLDER_LIKE) ?? []).filter((token) => !PLACEHOLDER_EXACT.test(token));
  const resolved = String(text).replace(PLACEHOLDER, (token, namespace, path) => {
    const value = path.slice(1).split('.').reduce((object, key) => object?.[key], values[namespace]);
    if (value === undefined || value === null) {
      unresolved.push(token);
      return token;
    }
    return display(value);
  });
  return { text: resolved, unresolved, invalid };
}

// The {project.…} values the config schema has; any other path is a typo in the text.
export const PROJECT_PLACEHOLDERS = ['name', 'language.repo', 'language.productCopy'];

// An option can be renamed to fit; a {project.…} name can only be one the config has.
export function invalidPlaceholder(token) {
  const fix = token.startsWith('{project.')
    ? `Correct it to one of the project placeholders: ${PROJECT_PLACEHOLDERS.map((key) => `{project.${key}}`).join(', ')}`
    : 'Correct it, and rename the option it refers to if there is one (e.g. max-items to max_items)';
  return `invalid placeholder ${token}: the names after the dot may use only letters, digits and _. ${fix}`;
}

export const renderPlaceholders = (text, values) => resolvePlaceholders(text, values).text;

// {options.x} of the pack; other tokens stay as written.
export const withPackOptions = (text, pack) => renderPlaceholders(text, { options: pack.options });

// ---- manifests ----

const OPTION_TYPES = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number',
  boolean: (value) => typeof value === 'boolean',
  array: Array.isArray,
  object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
};

// Schema errors plus the cross-field rules, as { path, message }.
export function validatePackManifest(manifest, dirName) {
  const errors = validate(loadSchema('pack'), manifest);
  if (errors.length) return errors;
  const add = (path, message) => errors.push({ path, message });
  if (manifest.id !== dirName) add('$.id', `must equal the directory name "${dirName}"`);
  const variants = Object.keys(manifest.variants ?? {});
  if (manifest.defaultVariant !== undefined && !variants.includes(manifest.defaultVariant)) {
    add('$.defaultVariant', `must name a variant (${variants.join(', ') || 'none defined'})`);
  }
  const scripts = Object.keys(manifest.scripts ?? {});
  const known = scripts.join(', ') || 'none defined';
  if (manifest.checkDiscovery !== undefined && !scripts.includes(manifest.checkDiscovery)) add('$.checkDiscovery', `must name a script (${known})`);
  (manifest.scopeScripts ?? []).forEach((name, i) => {
    if (!scripts.includes(name)) add(`$.scopeScripts[${i}]`, `must name a script (${known})`);
  });
  for (const [name, spec] of Object.entries(manifest.options ?? {})) {
    if ('default' in spec && !OPTION_TYPES[spec.type](spec.default)) add(`$.options.${name}.default`, `must be a ${spec.type}`);
  }
  const single = manifest.testRunner?.single;
  if (single !== undefined) {
    const problem = singleTestTemplateError(single);
    if (problem) add('$.testRunner.single', problem);
    if (single.replace(NAME_SEGMENT, '').includes('{name}')) add('$.testRunner.single', '{name} must sit inside an optional [ … ] segment');
  }
  const detects = [['$.detect', manifest.detect], ...Object.entries(manifest.variants ?? {}).map(([name, variant]) => [`$.variants.${name}.detect`, variant.detect])];
  for (const [path, items] of detects) {
    (items ?? []).forEach((item, i) => {
      const problem = item.glob === undefined ? null : globError(item.glob);
      if (problem) add(`${path}[${i}].glob`, problem);
    });
  }
  return errors;
}

export function readPackManifest(root) {
  const file = join(root, 'pack.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw failedError(`${file}: ${error.code === 'ENOENT' ? 'missing' : `not valid JSON (${error.message})`}`, `Fix ${file}.`);
  }
  const errors = validatePackManifest(manifest, basename(root));
  if (!errors.length) {
    const named = [manifest.rules, ...Object.values(manifest.variants ?? {}).map((variant) => variant.rules), ...Object.values(manifest.scripts ?? {})];
    for (const name of named.filter(Boolean)) {
      if (!existsSync(join(root, name))) errors.push({ path: '$', message: `names ${name}, which does not exist` });
    }
  }
  if (errors.length) {
    throw failedError(errors.map((error) => `${file}: ${error.path}: ${error.message}`).join('\n'), `Correct ${file}.`, { errors });
  }
  return manifest;
}

// Project-local packs (.claude/dev-workflow/packs/<id>/) come before the bundled ones.
function locatePack(configRoot, id) {
  const bundled = join(packsDir, id);
  const hasBundled = existsSync(join(bundled, 'pack.json'));
  const project = configRoot ? join(configRoot, PROJECT_PACKS_DIR, id) : null;
  if (project && existsSync(join(project, 'pack.json'))) return { root: project, source: 'project', shadows: hasBundled };
  return hasBundled ? { root: bundled, source: 'plugin', shadows: false } : null;
}

const listDir = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

export function listAvailablePacks(configRoot) {
  const ids = new Set([...listDir(packsDir), ...(configRoot ? listDir(join(configRoot, PROJECT_PACKS_DIR)) : [])]);
  return [...ids].filter((id) => locatePack(configRoot, id)).sort();
}

function resolveOptions(id, manifest, given = {}) {
  const specs = manifest.options ?? {};
  const options = {};
  const errors = [];
  for (const [name, spec] of Object.entries(specs)) {
    if (name in given) {
      if (OPTION_TYPES[spec.type](given[name])) options[name] = given[name];
      else errors.push(`pack ${id}: option ${name} must be a ${spec.type} (got ${JSON.stringify(given[name])})`);
    } else if ('default' in spec) {
      options[name] = structuredClone(spec.default);
    } else if (spec.required) {
      errors.push(`pack ${id}: option ${name} is required. Add it: { "id": "${id}", "options": { "${name}": … } }`);
    }
  }
  for (const name of Object.keys(given)) {
    if (!(name in specs)) errors.push(`pack ${id}: unknown option ${name} (known: ${Object.keys(specs).join(', ') || 'none'})`);
  }
  return { options, errors };
}

function resolveVariant(id, manifest, entry) {
  const names = Object.keys(manifest.variants ?? {});
  if (!names.length) return entry.variant === undefined ? { variant: null } : { error: `pack ${id} has no variants; remove "variant"` };
  const variant = entry.variant ?? manifest.defaultVariant;
  if (variant === undefined) return { error: `pack ${id}: choose a variant (${names.join(', ')})` };
  if (!names.includes(variant)) return { error: `pack ${id}: unknown variant ${variant} (known: ${names.join(', ')})` };
  return { variant };
}

// The rules file of the pack and, after it, the chosen variant's file: [{ path, isVariant }].
export function packRuleFiles(pack) {
  const files = [];
  if (pack.manifest.rules) files.push({ path: join(pack.root, pack.manifest.rules), isVariant: false });
  const variantRules = pack.variant ? pack.manifest.variants[pack.variant].rules : null;
  if (variantRules) files.push({ path: join(pack.root, variantRules), isVariant: true });
  return files;
}

// Active packs in layering order: core, then for each config entry its requires first, then itself.
// ws needs { configRoot, config } with a normalized config. All problems come in one error (exit 1).
export function resolvePacks(ws, { onWarning = () => {} } = {}) {
  const { configRoot, config } = ws;
  const wanted = new Map(config.packs.map((entry) => [entry.id, entry]));
  const resolved = [];
  const failed = new Set();
  const visiting = [];
  const errors = [];

  const visit = (id, requiredBy) => {
    if (failed.has(id) || resolved.some((pack) => pack.id === id)) return;
    if (visiting.includes(id)) {
      errors.push(`circular requires: ${[...visiting.slice(visiting.indexOf(id)), id].join(' -> ')}`);
      return;
    }
    const location = locatePack(configRoot, id);
    if (!location) {
      failed.add(id);
      const by = requiredBy ? ` (required by ${requiredBy})` : '';
      errors.push(`pack ${id} not found${by} (looked in ${join(PROJECT_PACKS_DIR, id)} and the plugin). Available: ${listAvailablePacks(configRoot).join(', ')}`);
      return;
    }
    let manifest;
    try {
      manifest = readPackManifest(location.root);
    } catch (error) {
      failed.add(id);
      errors.push(...error.message.split('\n'));
      return;
    }
    if (location.shadows) onWarning(`project pack ${id} (${join(PROJECT_PACKS_DIR, id)}) shadows the bundled pack ${id}`);
    visiting.push(id);
    for (const requirement of manifest.requires ?? []) {
      if (!wanted.has(requirement) && !resolved.some((pack) => pack.id === requirement)) {
        onWarning(`pack ${requirement} added because ${id} requires it; add it to packs in ${CONFIG_FILE} to silence this`);
      }
      visit(requirement, id);
    }
    visiting.pop();
    const entry = wanted.get(id) ?? { id };
    const { variant, error } = resolveVariant(id, manifest, entry);
    if (error) errors.push(error);
    const { options, errors: optionErrors } = resolveOptions(id, manifest, entry.options);
    errors.push(...optionErrors);
    // Checked with the options filled in, as cw classify matches them (packComplexityRules).
    (manifest.complexity?.escalate ?? []).forEach((item, i) => (item.paths ?? []).forEach((glob, j) => {
      const rendered = renderPlaceholders(glob, { options });
      const problem = globError(rendered);
      if (problem) errors.push(`pack ${id}: complexity.escalate[${i}].paths[${j}] ${rendered}: ${problem}`);
    }));
    const pack = { id, root: location.root, source: location.source, shadows: location.shadows, manifest, variant: variant ?? null, options, version: manifest.version };
    pack.files = [join(location.root, 'pack.json'), ...(error ? [] : packRuleFiles(pack).map((file) => file.path))];
    resolved.push(pack);
  };

  visit('core');
  for (const entry of config.packs) visit(entry.id);
  for (const pack of resolved) {
    for (const other of pack.manifest.conflicts ?? []) {
      if (resolved.some((candidate) => candidate.id === other)) errors.push(`pack ${pack.id} conflicts with pack ${other}; remove one of them`);
    }
  }
  if (errors.length) {
    throw failedError(
      `Pack resolution failed:\n${errors.map((error) => `- ${error}`).join('\n')}`,
      `Correct packs in ${CONFIG_FILE} (or the named pack.json), then run cw rules build.`,
      { errors },
    );
  }
  return resolved;
}

export const packById = (packs, id) => packs.find((pack) => pack.id === id);

// ---- pack data read by other areas ----

const unique = (items) => [...new Set(items)];

// Complexity minimums contributed by packs, in the shape of config complexity.escalate (§5).
export const packComplexityRules = (packs) =>
  packs.flatMap((pack) =>
    (pack.manifest.complexity?.escalate ?? []).map((item) => ({
      ...item,
      ...(item.paths ? { paths: item.paths.map((path) => withPackOptions(path, pack)) } : {}),
      source: `pack:${pack.id}`,
    })),
  );

// The scripts the reviewer's scope step runs (§6 R1), as '<pack>:<script>' references.
export const scopeScripts = (packs) => packs.flatMap((pack) => (pack.manifest.scopeScripts ?? []).map((name) => `${pack.id}:${name}`));

// The last active pack that declares a test runner wins.
export function testRunnerOf(packs) {
  const pack = [...packs].reverse().find((candidate) => candidate.manifest.testRunner?.single);
  return pack ? { pack: pack.id, single: pack.manifest.testRunner.single } : null;
}

const NAME_SEGMENT = /\[([^\]]*\{name\}[^\]]*)\]/;
const SHELL_SAFE = /^[A-Za-z0-9_./@%+=:,-]+$/;
const shellQuote = (text) => (SHELL_SAFE.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`);
const regexEscape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TEMPLATE_PLACEHOLDER = /\{(?:file|name)\}/y;
const isQuote = (char) => char === '"' || char === "'";

// Reads a single-test template the way sh splits it into words: { spans } holds each {file} and
// {name} with its start and end, its own quotes included when it is quoted on its own; otherwise
// { problem }. A placeholder inside a longer quoted word ("./{file}"), next to a quote ("a"{file}) or
// after a \ would put the shell-quoted value where its quotes don't hold: a file name with $(…) would run.
function scanTemplate(template) {
  const spans = [];
  let quote = null;
  let open = -1;
  for (let i = 0; i < template.length; i += 1) {
    const char = template[i];
    TEMPLATE_PLACEHOLDER.lastIndex = i;
    const placeholder = TEMPLATE_PLACEHOLDER.exec(template)?.[0];
    if (placeholder) {
      const end = i + placeholder.length;
      // $'…' and $"…" are bash's ANSI-C and locale quoting, where the value's quotes don't hold.
      const ownQuotes = quote !== null && open === i - 1 && template[end] === quote && template[open - 1] !== '$';
      const unquoted = quote === null && !['\\', '$'].includes(template[i - 1]) && !isQuote(template[i - 1]) && !isQuote(template[end]);
      if (!ownQuotes && !unquoted) {
        return { problem: `has ${placeholder} inside a longer quoted word, next to a quote or after a \\ or $, where the shell quoting of its value doesn't hold; quote it on its own ("${placeholder}") or leave it unquoted with no quote, $ or \\ next to it` };
      }
      spans.push(ownQuotes ? { placeholder, start: i - 1, end: end + 1 } : { placeholder, start: i, end });
      i = end - 1;
    } else if (quote === null) {
      if (char === '\\' && template[i + 1] !== '{') i += 1;
      else if (isQuote(char)) [quote, open] = [char, i];
    } else if (char === quote) {
      quote = null;
    } else if (quote === '"' && char === '\\' && '"\\$`'.includes(template[i + 1])) {
      i += 1;
    }
  }
  return { spans };
}

// The optional [ … {name} … ] segments: dropped without a test name, kept (unbracketed) with one.
const NAME_SEGMENTS = /\s*\[([^\][]*\{name\}[^\][]*)\]/g;
const withSegments = (template, keep) => template.replace(NAME_SEGMENTS, (whole, inner) => (keep ? ` ${inner}` : ''));

// Why a single-test template (testRunner.single or packages[].testSingle) can't be used, or null.
// Without {file} a proof runs the whole suite, so any failing test would prove it. The template is
// read as written and as the command with and without a test name, so validation and rendering agree.
export function singleTestTemplateError(template) {
  if (!template.includes('{file}')) return 'must contain {file} (without it a proof runs the whole suite)';
  if (!withSegments(template, false).includes('{file}')) return 'must contain {file} outside the optional [ … {name} … ] segment (without a test name the segment is dropped, and a proof would run the whole suite)';
  for (const variant of [template, withSegments(template, false), withSegments(template, true)]) {
    const { problem } = scanTemplate(variant);
    if (problem) return problem;
  }
  return null;
}

// Renders a single-test template (testRunner.single or packages[].testSingle). A [ … {name} … ]
// segment is kept only with a name; {name} outside a segment makes the name required. The name is
// regex-escaped (vitest -t and node --test-name-pattern take a regexp); both values are shell-quoted
// and replace the spans scanTemplate finds in the command left after the segments, so only a
// placeholder's own quotes give way to the quoted value. A template scanTemplate refuses is exit 3.
export function singleTestCommand(template, { file, name = null } = {}) {
  const refused = (problem) => preconditionError(
    `The single-test command "${template}" ${problem}.`,
    `Correct packages[].testSingle in ${CONFIG_FILE} (or the pack's testRunner.single), e.g. "node --test {file}", then run cw config validate.`,
  );
  const problem = singleTestTemplateError(template);
  if (problem) throw refused(problem);
  if (name && !template.includes('{name}')) {
    throw usageError(`The single-test command "${template}" cannot select a test by name.`, 'Pass --test <package>:<file> without ::<name>, or give packages[].testSingle a {name}.');
  }
  const command = withSegments(template, Boolean(name));
  if (!name && command.includes('{name}')) {
    throw usageError(`The single-test command "${template}" needs a test name.`, 'Pass --test <package>:<file>::<test name>.');
  }
  const scan = scanTemplate(command);
  if (scan.problem) throw refused(scan.problem);
  let rendered = command;
  for (const { placeholder, start, end } of scan.spans.reverse()) {
    rendered = `${rendered.slice(0, start)}${shellQuote(placeholder === '{file}' ? file : regexEscape(name))}${rendered.slice(end)}`;
  }
  return rendered.trim();
}

export function packGuards(packs) {
  const guards = { dependencyCommands: [], commands: [], ports: [] };
  for (const pack of packs) {
    const own = pack.manifest.guards ?? {};
    guards.dependencyCommands.push(...(own.dependencyCommands ?? []));
    guards.commands.push(...(own.commands ?? []).map((command) => withPackOptions(command, pack)));
    guards.ports.push(...(own.ports ?? []));
  }
  return { dependencyCommands: unique(guards.dependencyCommands), commands: unique(guards.commands), ports: unique(guards.ports) };
}

export function packSettings(packs) {
  const settings = { allow: [], ask: [], deny: [] };
  for (const pack of packs) {
    for (const key of Object.keys(settings)) settings[key].push(...(pack.manifest.settings?.[key] ?? []));
  }
  return { allow: unique(settings.allow), ask: unique(settings.ask), deny: unique(settings.deny) };
}

// ---- pack scripts (cw run, review scope, init) ----

// '<pack>:<script>' → { pack, name, path }; a bad reference, an inactive pack or an unknown script is exit 2.
export function packScript(packs, reference) {
  const match = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*):([A-Za-z0-9_-]+)$/.exec(String(reference ?? ''));
  if (!match) throw usageError(`"${reference ?? ''}" is not a pack script reference`, 'Use <pack>:<script>, e.g. cw run vitest:no-focus.');
  const [, id, name] = match;
  const pack = packById(packs, id);
  if (!pack) {
    throw usageError(`pack ${id} is not active in this project`, `Use a script of an active pack (${packs.map((candidate) => candidate.id).join(', ')}), or add ${id} to packs in ${CONFIG_FILE}.`);
  }
  const file = pack.manifest.scripts?.[name];
  if (!file) {
    const names = Object.keys(pack.manifest.scripts ?? {}).map((script) => `${id}:${script}`);
    throw usageError(`pack ${id} has no script ${name}`, names.length ? `Its scripts: ${names.join(', ')}.` : `Pack ${id} has no scripts.`);
  }
  return { pack, name, path: join(pack.root, file) };
}

// Runs node <script> with cwd = workTree, which the caller resolves from task.json or the work repo,
// never from the process cwd. Returns { code, stdout, stderr, timedOut }; a spawn failure is exit 4.
export function runPackScript(packs, reference, {
  workTree, configRoot, task = '', taskDir = '', base = '', defaultBase = '', packageDirs = ['.'], args = [], timeoutMs = SCRIPT_TIMEOUT_MS,
} = {}) {
  const { pack, path } = packScript(packs, reference);
  const env = {
    CW_WORK_TREE: workTree,
    CW_CONFIG_ROOT: configRoot,
    CW_PACK_OPTIONS: JSON.stringify(pack.options),
    CW_TASK: task,
    CW_TASK_DIR: taskDir,
    CW_BASE: base,
    CW_DEFAULT_BASE: defaultBase,
    CW_PACKAGE_DIRS: JSON.stringify(packageDirs),
  };
  const result = run(process.execPath, [path, ...args], { cwd: workTree, env, timeoutMs });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  if (result.error && !timedOut) throw new CwError(`cw run ${reference}: could not run ${path} in ${workTree}: ${result.error.message}`);
  return { code: timedOut ? 124 : result.code, stdout: result.stdout, stderr: result.stderr, timedOut };
}

// ---- detection (cw init) ----

function readDependencies(workRepo, dirs) {
  const dependencies = new Map();
  for (const dir of dirs) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(workRepo, dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    for (const block of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(manifest[block] ?? {})) if (!dependencies.has(name)) dependencies.set(name, String(range));
    }
  }
  return dependencies;
}

// The packs whose detect entries hit the work repo: [{ id, variant, defaultVariant, areas }]. files are
// work-repo relative paths (e.g. git ls-files); variant is the variant whose detect entry matched (the
// dependency's major version), else null, and then defaultVariant applies.
export function detectPacks(workRepo, { files = [], packageDirs = [], configRoot = null } = {}) {
  const dependencies = readDependencies(workRepo, ['.', ...packageDirs]);
  const hit = (rule) => {
    if (rule.glob) return files.some((file) => matchGlob(file, rule.glob));
    const range = dependencies.get(rule.dependency);
    if (range === undefined) return false;
    return rule.major === undefined || new RegExp(`^[\\^~>=v\\s]*${rule.major}(\\.|$)`).test(range);
  };
  const found = [];
  for (const id of listAvailablePacks(configRoot)) {
    const manifest = readPackManifest(locatePack(configRoot, id).root);
    if (!(manifest.detect ?? []).some(hit)) continue;
    const detected = Object.entries(manifest.variants ?? {}).find(([, spec]) => (spec.detect ?? []).some(hit));
    found.push({ id, variant: detected?.[0] ?? null, defaultVariant: manifest.defaultVariant ?? null, areas: manifest.areas ?? [] });
  }
  return found;
}

// ---- procedures (§6 point 2) ----

const PROCEDURE_KEYS = ['name', 'role', 'description', 'when', 'scripts', 'rules'];
const WHEN_KEYS = ['paths', 'areas', 'keywords', 'phases'];
const PROCEDURE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const mdFiles = (dir) => listDir(dir).filter((name) => name.endsWith('.md')).sort();
const roleDirs = (dir) => listDir(dir).filter((name) => statSync(join(dir, name)).isDirectory());

function readProcedure(path, { role, origin, pack, ws, activeScripts, problems, onWarning }) {
  const where = relative(pack?.source === 'plugin' ? packsDir : ws.configRoot, path);
  let parsed;
  try {
    parsed = parseFrontmatter(readFileSync(path, 'utf8'), where);
  } catch (error) {
    problems.push(error.message);
    return null;
  }
  const { data, body } = parsed;
  const before = problems.length;
  const fail = (message) => problems.push(`${where}: ${message}`);
  const list = (value, key) => {
    if (value === undefined) return [];
    if (Array.isArray(value)) return value.map(String);
    fail(`${key} must be a list, e.g. ${key}: [a, b]`);
    return [];
  };
  for (const key of Object.keys(data)) if (!PROCEDURE_KEYS.includes(key)) fail(`unknown key "${key}" (allowed: ${PROCEDURE_KEYS.join(', ')})`);
  if (typeof data.name !== 'string' || !PROCEDURE_NAME.test(data.name)) fail('name must be lowercase words joined by hyphens, e.g. express-route');
  if (data.role !== role) fail(`role must be ${role}, the directory the file is in`);
  if (typeof data.description !== 'string' || !data.description.trim()) fail('description is required (one line)');
  const whenData = data.when ?? {};
  const isMap = whenData !== null && typeof whenData === 'object' && !Array.isArray(whenData);
  if (!isMap) fail(`when must hold ${WHEN_KEYS.join(', ')} as nested keys`);
  const when = {};
  for (const key of WHEN_KEYS) when[key] = isMap ? list(whenData[key], `when.${key}`) : [];
  for (const key of isMap ? Object.keys(whenData) : []) if (!WHEN_KEYS.includes(key)) fail(`unknown key "when.${key}" (allowed: ${WHEN_KEYS.join(', ')})`);
  for (const glob of when.paths) {
    const problem = globError(glob);
    if (problem) fail(`when.paths ${glob}: ${problem}`);
  }
  if (when.phases.length && role !== 'orchestrator') fail('when.phases is only for orchestrator procedures');
  const scripts = list(data.scripts, 'scripts');
  for (const script of scripts) {
    if (!activeScripts.has(script)) onWarning(`${where}: script ${script} is not a script of an active pack`);
  }
  const values = { options: pack?.options ?? {}, project: ws.config.project };
  const rendered = resolvePlaceholders(body, values);
  for (const token of rendered.unresolved) {
    fail(pack || !token.startsWith('{options.') ? `unresolved placeholder ${token}` : `unresolved placeholder ${token}: project procedures have no pack options`);
  }
  for (const token of rendered.invalid) fail(invalidPlaceholder(token));
  if (!rendered.text.trim()) fail('has no steps; write them under the frontmatter');
  if (problems.length > before) return null;
  return { name: data.name, role, description: data.description.trim(), origin, path, when, scripts, rules: list(data.rules, 'rules'), body: rendered.text.trim() };
}

// Every procedure of the active packs (layer order) and of the project (last), all roles, files in
// name order. A project procedure replaces the pack procedure of the same role and name in place.
export function loadProcedures(ws, packs, { onWarning = () => {} } = {}) {
  const problems = [];
  const procedures = [];
  const activeScripts = new Set(packs.flatMap((pack) => Object.keys(pack.manifest.scripts ?? {}).map((name) => `${pack.id}:${name}`)));
  const add = (procedure) => {
    if (!procedure) return;
    const index = procedures.findIndex((other) => other.role === procedure.role && other.name === procedure.name);
    if (index === -1) {
      procedures.push(procedure);
    } else if (procedure.origin === 'project' && procedures[index].origin !== 'project') {
      onWarning(`project procedure ${procedure.role}/${procedure.name} replaces the one from pack ${procedures[index].origin}`);
      procedures[index] = procedure;
    } else {
      problems.push(`${procedure.path}: duplicates procedure ${procedure.role}/${procedure.name} of ${procedures[index].path}; rename one`);
    }
  };
  // Roles in ROLES order, not directory order, so the result is the same on every file system.
  const loadDir = (dir, origin, pack) => {
    const present = roleDirs(dir);
    for (const role of present.filter((name) => !ROLES.includes(name))) {
      problems.push(`${join(dir, role)}: unknown role directory (roles: ${ROLES.join(', ')})`);
    }
    for (const role of ROLES.filter((name) => present.includes(name))) {
      for (const file of mdFiles(join(dir, role))) {
        add(readProcedure(join(dir, role, file), { role, origin, pack, ws, activeScripts, problems, onWarning }));
      }
    }
  };
  for (const pack of packs) loadDir(join(pack.root, 'procedures'), pack.id, pack);
  loadDir(join(ws.configRoot, PROJECT_PROCEDURES_DIR), 'project', null);
  if (problems.length) {
    throw failedError(`Procedures failed to load:\n${problems.map((problem) => `- ${problem}`).join('\n')}`, 'Correct the named procedure files.', { problems });
  }
  return procedures;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word, case-insensitive; letters and digits of any script count as word characters.
export const containsWord = (text, word) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(word)}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text);

// An empty when always applies; otherwise any one trigger is enough.
export function procedureApplies(procedure, { paths = [], areas = [], text = '', phase } = {}) {
  const { when } = procedure;
  if (!when.paths.length && !when.areas.length && !when.keywords.length && !when.phases.length) return true;
  return (
    (phase !== undefined && when.phases.includes(phase))
    || paths.some((path) => matchAny(path, when.paths))
    || areas.some((area) => when.areas.includes(area))
    || when.keywords.some((word) => containsWord(text, word))
  );
}

// The procedures for a role and a task, in load order. Same input, same output.
export const selectProcedures = (procedures, { role, ...input } = {}) =>
  procedures.filter((procedure) => (!role || procedure.role === role) && procedureApplies(procedure, input));
