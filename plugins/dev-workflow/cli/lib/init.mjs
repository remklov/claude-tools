// cw init (§8, §12): detects the project (the in-place app repo, npm workspaces, areas, packs with
// variants from the pack manifests, options, checks from the packs' check discovery), proposes a
// config, asks the open questions in the terminal, and writes the config, the compiled rules, the
// merged .claude/settings.json, the CLAUDE.md section and the bootstrap script. It never writes inside
// Claude Code: the sandbox protects the session's settings files (§8, S8), and it never reads or
// writes .claude/settings.local.json.
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname, join, relative } from 'node:path';
import { DEFAULT_LOCAL_TICKETS, DEFAULT_TICKET_SOURCE, formatConfigErrors, loadPreset, normalizePackagePath, validateConfig, withDefaults } from './config.mjs';
import { readText, writeAtomic } from './fsx.mjs';
import { currentBranch, gitResult, tryGit } from './git.mjs';
import { detectHost, quote } from './host/index.mjs';
import { CwError, EXIT, failedError, preconditionError } from './out.mjs';
import { detectPacks, packSettings, resolvePacks, runPackScript } from './packs.mjs';
import { templatesDir } from './paths.mjs';
import { LOCK_FILE, MARKER_PREFIX, OUT_DIR, buildRulebook, writeRulebook } from './rules.mjs';
import { render } from './template.mjs';
import { CONFIG_RELATIVE } from './workspace.mjs';

export const MARKERS = { start: '<!-- dev-workflow:start -->', end: '<!-- dev-workflow:end -->' };
export const BOOTSTRAP_RELATIVE = join('scripts', 'setup-dev-workflow.sh');
const DEFAULT_AREA = 'app';

export function assertOutsideClaudeCode(env, action) {
  if (env.CLAUDECODE === '1') {
    throw preconditionError(
      `${action} writes .claude/settings.json, which Claude Code protects in this session (CLAUDECODE=1).`,
      'Run scripts/setup-dev-workflow.sh (or setup.sh of the marketplace clone), or cw init --interactive, in your own terminal.',
    );
  }
}

// --- detection ---------------------------------------------------------------------------------

const gitTop = (dir) => {
  const result = gitResult(['rev-parse', '--show-toplevel'], { cwd: dir });
  return result.code === 0 ? realpathSync(result.stdout.trim()) : null;
};
const isIgnored = (repo, path) => gitResult(['check-ignore', '-q', path], { cwd: repo }).code === 0;

function readPackage(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

const subdirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
};

// Direct child directories with their own .git that the outer repo ignores (D5 in-place layout).
const nestedRepos = (root) => subdirs(root).filter((name) => name !== '.git' && existsSync(join(root, name, '.git')) && isIgnored(root, `${name}/`)).sort();

// npm workspaces: plain paths and "dir/*" patterns are expanded; anything else is reported.
function workspaceDirs(workRepo, rootPkg, warnings) {
  const patterns = Array.isArray(rootPkg?.workspaces) ? rootPkg.workspaces : (rootPkg?.workspaces?.packages ?? []);
  const dirs = [];
  for (const raw of patterns) {
    const pattern = String(raw).replace(/^\.\//, '').replace(/\/+$/, '');
    if (pattern.endsWith('/*') && !/[*?[{]/.test(pattern.slice(0, -2))) {
      const parent = pattern.slice(0, -2);
      for (const name of subdirs(join(workRepo, parent)).sort()) if (readPackage(join(workRepo, parent, name))) dirs.push(`${parent}/${name}`);
    } else if (!/[*?[{]/.test(pattern)) {
      if (readPackage(join(workRepo, pattern))) dirs.push(pattern);
    } else {
      warnings.push(`The workspace pattern "${raw}" is not expanded (only plain paths and "dir/*" are); add its packages by hand.`);
    }
  }
  return [...new Set(dirs)];
}

const depsOf = (pkg) => ({ ...pkg?.peerDependencies, ...pkg?.devDependencies, ...pkg?.dependencies });

// react -> frontend, express -> backend (§8), always in this order.
const areasOf = (...depsList) => [['frontend', 'react'], ['backend', 'express']].filter(([, dep]) => depsList.some((deps) => deps[dep])).map(([area]) => area);

// Work-repo-relative files for the packs' detect globs: tracked and untracked, not ignored files of
// the work repo; without a repository of its own, the package.json and tsconfig.json files at the top,
// one level down and in the workspaces.
function workFiles(workRepo, dirs) {
  if (!existsSync(workRepo)) return [];
  if (gitTop(workRepo) === realpathSync(workRepo)) {
    const result = gitResult(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: workRepo });
    if (result.code === 0) return result.stdout.split('\0').filter(Boolean);
  }
  const top = subdirs(workRepo).filter((name) => name !== 'node_modules' && !name.startsWith('.'));
  return [...new Set(['.', ...top, ...dirs])]
    .flatMap((dir) => ['package.json', 'tsconfig.json'].map((name) => (dir === '.' ? name : `${dir}/${name}`)))
    .filter((file) => existsSync(join(workRepo, file)));
}

// Checks per package directory from the checkDiscovery scripts of the detected packs (node-npm reads
// the package.json scripts), so cw init and cw run share one source: { '<dir>': { test?, … } }.
function discoverChecks({ projectRoot, workRepo, packs: entries, packageDirs, warnings }) {
  if (!existsSync(workRepo)) return {};
  let packs;
  try {
    packs = resolvePacks({ configRoot: projectRoot, config: withDefaults({ project: { name: basename(projectRoot) }, packs: entries, packages: [] }) });
  } catch (error) {
    if (!(error instanceof CwError)) throw error;
    warnings.push(`No checks were discovered because the detected packs do not resolve: ${error.message}\nAdd the packages' checks by hand.`);
    return {};
  }
  const checks = {};
  for (const pack of packs.filter((candidate) => candidate.manifest.checkDiscovery)) {
    const reference = `${pack.id}:${pack.manifest.checkDiscovery}`;
    const result = runPackScript(packs, reference, { workTree: workRepo, configRoot: projectRoot, packageDirs });
    let found = null;
    try {
      found = result.code === 0 ? JSON.parse(result.stdout) : null;
    } catch {
      found = null;
    }
    if (found === null || typeof found !== 'object' || Array.isArray(found)) {
      const reason = result.stderr.trim() || `exit ${result.code}, no JSON object on stdout`;
      warnings.push(`cw run ${reference} found no checks (${reason}); add the packages' checks by hand.`);
      continue;
    }
    for (const [dir, own] of Object.entries(found)) checks[dir] = { ...checks[dir], ...own };
  }
  return checks;
}

// JSON with comments and trailing commas (tsconfig.json), parsed without a dependency.
export function parseJsonc(text) {
  // Copies strings verbatim; drop(source, i) returns the index of the last character it drops at i, or -1.
  const scan = (source, drop) => {
    let out = '';
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === '"') {
        let end = i + 1;
        while (end < source.length && source[end] !== '"') end += source[end] === '\\' ? 2 : 1;
        out += source.slice(i, end + 1);
        i = end;
      } else {
        const last = drop(source, i);
        if (last === -1) out += source[i];
        else i = last;
      }
    }
    return out;
  };
  const comments = (source, i) => {
    if (source.startsWith('//', i)) {
      const newline = source.indexOf('\n', i);
      return newline === -1 ? source.length : newline - 1;
    }
    if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2);
      return close === -1 ? source.length : close + 1;
    }
    return -1;
  };
  const trailingCommas = (source, i) => (source[i] === ',' && /^\s*[}\]]/.test(source.slice(i + 1)) ? i : -1);
  return JSON.parse(scan(scan(String(text), comments), trailingCommas));
}

function moduleResolutionOf(dirs) {
  for (const dir of dirs) {
    const text = readText(join(dir, 'tsconfig.json'));
    if (text === null) continue;
    try {
      const value = parseJsonc(text).compilerOptions?.moduleResolution;
      if (value) return String(value).toLowerCase();
    } catch {
      // An unreadable tsconfig leaves the option to the question.
    }
  }
  return null;
}

const CONFIG_FILE = /^(vitest|vite)\.config\.[cm]?[jt]s$/;
function vitestGlobalsOf(dirs) {
  return dirs.some((dir) => {
    let names = [];
    try {
      names = readdirSync(dir).filter((name) => CONFIG_FILE.test(name));
    } catch {
      return false;
    }
    return names.some((name) => /globals\s*:\s*true/.test(readText(join(dir, name), '')));
  });
}

// The detection notes that a config can resolve (openNotes).
const noChecksNote = (pkg) => `Package ${pkg.id} (${pkg.path}) has no checks, so cw checks would pass without running anything; add at least a test command (cw init --interactive asks for it).`;
const currentBranchNote = (branch) => `origin/HEAD, origin/main and origin/master are unknown: git.defaultBase is the current branch ${branch}. Check that it is the branch tasks start from and target.`;

// origin/HEAD, else origin/main or origin/master (local refs, no fetch; a repo whose origin was added
// and pushed has no origin/HEAD), else the current branch, with a warning unless it is main or master,
// since another branch may be a feature branch, else main.
function defaultBaseOf(workRepo, warnings) {
  if (!existsSync(workRepo)) return 'main';
  const remoteHead = tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: workRepo });
  if (remoteHead) return remoteHead.replace(/^origin\//, '');
  const known = ['main', 'master'].find((name) => gitResult(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`], { cwd: workRepo }).code === 0);
  if (known) return known;
  const current = currentBranch(workRepo);
  if (!current) return 'main';
  if (!['main', 'master'].includes(current)) warnings.push(currentBranchNote(current));
  return current;
}

const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';

function uniqueIds(packages) {
  const seen = new Set();
  for (const pkg of packages) {
    let id = pkg.id;
    for (let n = 2; seen.has(id); n += 1) id = `${pkg.id}-${n}`;
    pkg.id = id;
    seen.add(id);
  }
  return packages;
}

// What cw init found, read-only. appRoot forces the application directory ('' or '.' = worktree mode).
export function detectProject(cwd, { appRoot: forced } = {}) {
  const projectRoot = gitTop(cwd);
  if (!projectRoot) throw preconditionError(`${cwd} is not inside a git repository.`, 'Run cw init in the project root (git init first).');
  const parentTop = gitTop(dirname(projectRoot));
  if (parentTop && isIgnored(parentTop, `${relative(parentTop, projectRoot)}/`)) {
    throw preconditionError(`${projectRoot} is a nested repository that ${parentTop} ignores (the application repo).`, `Run cw init in the outer repository ${parentTop}.`);
  }
  const warnings = [];
  const candidates = nestedRepos(projectRoot);
  const appRoot = forced === undefined ? (candidates[0] ?? null) : String(forced).replace(/^\.\/?|\/+$/g, '') || null;
  if (forced === undefined && candidates.length > 1) warnings.push(`Several nested repositories: ${candidates.join(', ')}; using ${appRoot}.`);
  if (appRoot && !existsSync(join(projectRoot, appRoot, '.git'))) warnings.push(`${appRoot}/ is not a git repository yet; clone the application there.`);
  const mode = appRoot ? 'in-place' : 'worktree';
  const workRepo = appRoot ? join(projectRoot, appRoot) : projectRoot;

  const rootPkg = readPackage(workRepo);
  const dirs = workspaceDirs(workRepo, rootPkg, warnings);
  const infos = [{ path: '.', pkg: rootPkg }, ...dirs.map((dir) => ({ path: dir, pkg: readPackage(join(workRepo, dir)) }))];
  const allDeps = Object.assign({}, ...[...infos].reverse().map((info) => depsOf(info.pkg)));

  // Packs and variants from the manifests' detect entries (in pack id order), plus the options read
  // from the code; core is always active and never listed.
  const codeDirs = [workRepo, ...dirs.map((dir) => join(workRepo, dir))];
  const moduleResolution = moduleResolutionOf(codeDirs);
  const vitestGlobals = vitestGlobalsOf(codeDirs);
  const detectedOptions = {
    typescript: moduleResolution ? { moduleResolution } : null,
    'react-vite': vitestGlobals ? { vitestGlobals: true } : null,
    express: { appEntry: 'createApp()' },
  };
  const packs = detectPacks(workRepo, { files: workFiles(workRepo, dirs), packageDirs: dirs, configRoot: projectRoot })
    .filter(({ id }) => id !== 'core')
    .map(({ id, variant, defaultVariant }) => {
      if (!variant && defaultVariant) warnings.push(`No variant of pack ${id} matches the installed version; its default ${defaultVariant} applies. Check the pack's rules, or set packs[].variant.`);
      const options = detectedOptions[id];
      return variant || options ? { id, ...(variant ? { variant } : {}), ...(options ? { options } : {}) } : id;
    });

  const discovered = discoverChecks({ projectRoot, workRepo, packs, packageDirs: ['.', ...dirs], warnings });
  const checksAt = (dir) => discovered[dir] ?? {};
  const rootChecks = checksAt('.');
  const packages = Object.keys(rootChecks).length || !dirs.length
    ? [{ id: slug(basename(workRepo)), path: '.', areas: areasOf(...infos.map((info) => depsOf(info.pkg))), checks: rootChecks }]
    : infos.slice(1).map(({ path, pkg }) => ({ id: slug(basename(path)), path, areas: areasOf(depsOf(pkg)), checks: checksAt(path) }));
  uniqueIds(packages);
  const undetectedAreas = packages.filter((pkg) => !pkg.areas.length).map((pkg) => pkg.id);
  for (const pkg of packages) if (!pkg.areas.length) pkg.areas = [DEFAULT_AREA];
  for (const pkg of packages.filter((candidate) => !Object.keys(candidate.checks).length)) warnings.push(noChecksNote(pkg));

  const defaultBase = defaultBaseOf(workRepo, warnings);
  const host = existsSync(workRepo) ? detectHost({ workTree: workRepo, config: null }) : { kind: 'none', hostname: null, repo: null };
  return {
    projectRoot,
    mode,
    appRoot,
    appRootCandidates: candidates,
    workRepo,
    host: { kind: host.kind, hostname: host.hostname, repo: host.repo },
    dependencies: Object.fromEntries(['react', 'vite', 'express', 'typescript', 'vitest'].filter((name) => allDeps[name]).map((name) => [name, allDeps[name]])),
    packages,
    undetectedAreas,
    packs,
    moduleResolution,
    vitestGlobals,
    defaultBase,
    symlinkDirectories: ['node_modules', ...dirs.map((dir) => `${dir}/node_modules`)],
    warnings,
  };
}

// The detection notes that a valid config leaves open: the note of a package path that now has checks
// and the current-branch note once git.defaultBase is another branch are dropped.
export function openNotes(detection, config) {
  const { packages, git } = withDefaults(config);
  const checked = new Set(packages.filter((pkg) => Object.keys(pkg.checks).length).map((pkg) => pkg.path));
  const resolved = [
    ...detection.packages.filter((pkg) => checked.has(pkg.path)).map(noChecksNote),
    ...(git.defaultBase === detection.defaultBase ? [] : [currentBranchNote(detection.defaultBase)]),
  ];
  return detection.warnings.filter((warning) => !resolved.includes(warning));
}

// The §5 config for a detection, with the defaults spelled out.
export function proposeConfig(detection, preset = loadPreset('default')) {
  return {
    version: 1,
    project: { name: basename(detection.projectRoot), language: { repo: 'en', productCopy: 'en' } },
    workspace: detection.mode === 'in-place' ? { mode: 'in-place', appRoot: detection.appRoot } : { mode: 'worktree' },
    packs: structuredClone(detection.packs),
    packages: structuredClone(detection.packages),
    git: { preset: preset.id, defaultBase: detection.defaultBase, noTicketKey: preset.noTicketKey },
    tickets: { source: DEFAULT_TICKET_SOURCE, keyPattern: '^[A-Z][A-Z0-9]+-[0-9]+$', contextPath: DEFAULT_LOCAL_TICKETS },
    workflow: { maxReviewRounds: 3, confirm: ['l', 'xl'], maxQuestionsPerRound: 4 },
    guards: { ports: [], commands: [], devServer: 'allowed' },
    complexity: { escalate: [] },
    rules: { add: [], disable: [], extend: {}, override: {}, options: {}, allowProtected: false },
  };
}

// --- questions ---------------------------------------------------------------------------------

// The pack's config entry as an object (a bare id becomes { id }), or null.
function packEntry(config, id) {
  const index = config.packs.findIndex((entry) => (typeof entry === 'string' ? entry : entry.id) === id);
  if (index === -1) return null;
  if (typeof config.packs[index] === 'string') config.packs[index] = { id };
  return config.packs[index];
}
const hasPack = (config, id) => config.packs.some((entry) => (typeof entry === 'string' ? entry : entry.id) === id);
const setOption = (config, id, key, value) => {
  const entry = packEntry(config, id);
  entry.options = { ...entry.options, [key]: value };
};

const matches = (pattern, message) => (value) => (new RegExp(pattern).test(value) ? null : message);
const isLanguage = matches('^[a-z]{2}$', 'Use a two-letter ISO code, e.g. en or de.');

const DEFAULT_CONTEXT_PATH = 'docs/specs/{key}.md';
const contextPathProblem = (value) => {
  if (!value.includes('{key}')) return 'Name the file with {key}, e.g. docs/specs/{key}.md.';
  return value.startsWith('/') || value.split('/').includes('..') ? 'Use a path inside the project, without a leading / or ..' : null;
};

// The Jira site only belongs to source jira; the default ticket files only to source local.
function setTicketSource(config, source) {
  config.tickets.source = source;
  if (source !== 'jira') delete config.tickets.site;
  if (source !== 'local' && config.tickets.contextPath === DEFAULT_LOCAL_TICKETS) delete config.tickets.contextPath;
}

// The open questions in asking order; when() and default() are evaluated when the question is asked.
export function questionsFor(config, detection) {
  const areaQuestions = detection.undetectedAreas.map((id) => ({
    id: `packages.${id}.areas`,
    text: `Areas of package ${id} (comma-separated, e.g. frontend, backend)`,
    default: (c) => c.packages.find((pkg) => pkg.id === id).areas.join(', '),
    check: (value) => (value.split(',').map((area) => area.trim()).every((area) => /^[a-z][a-z0-9-]*$/.test(area)) ? null : 'Use lowercase words such as frontend, backend.'),
    apply: (c, value) => {
      c.packages.find((pkg) => pkg.id === id).areas = value.split(',').map((area) => area.trim()).filter(Boolean);
    },
  }));
  // A package without checks passes cw checks without running anything (§6 step 5, R2).
  const checkQuestions = config.packages.filter((pkg) => !Object.keys(pkg.checks ?? {}).length).map((pkg) => ({
    id: `packages.${pkg.id}.checks.test`,
    text: `Test command of package ${pkg.id}, run in ${pkg.path} (Enter: none)`,
    default: () => '',
    apply: (c, value) => {
      if (value) c.packages.find((candidate) => candidate.id === pkg.id).checks = { test: value };
    },
  }));
  return [
    { id: 'project.name', text: 'Project name', default: (c) => c.project.name, check: (value) => (value ? null : 'The name must not be empty.'), apply: (c, value) => { c.project.name = value; } },
    { id: 'project.language.repo', text: 'Language of the repository: code, comments, commits (ISO code)', default: (c) => c.project.language.repo, check: isLanguage, apply: (c, value) => { c.project.language.repo = value; } },
    { id: 'project.language.productCopy', text: 'Language of the product copy: UI texts (ISO code)', default: (c) => c.project.language.repo, check: isLanguage, apply: (c, value) => { c.project.language.productCopy = value; } },
    ...areaQuestions,
    ...checkQuestions,
    {
      id: 'packs.express.options.appEntry',
      when: (c) => hasPack(c, 'express'),
      text: 'Express: the expression tests use to get the app without listening',
      default: (c) => packEntry(c, 'express').options?.appEntry ?? 'createApp()',
      apply: (c, value) => setOption(c, 'express', 'appEntry', value),
    },
    {
      id: 'packs.typescript.options.moduleResolution',
      when: (c) => hasPack(c, 'typescript') && !detection.moduleResolution,
      text: 'TypeScript moduleResolution (bundler, nodenext, node16)',
      default: () => 'bundler',
      check: (value) => (/^[a-z0-9]+$/.test(value) ? null : 'Use the tsconfig value in lowercase, e.g. bundler.'),
      apply: (c, value) => setOption(c, 'typescript', 'moduleResolution', value),
    },
    { id: 'git.defaultBase', text: 'Default base branch', default: (c) => c.git.defaultBase, check: (value) => (value ? null : 'Name a branch.'), apply: (c, value) => { c.git.defaultBase = value; } },
    { id: 'git.noTicketKey', text: 'Key for work without a ticket', default: (c) => c.git.noTicketKey, check: matches('^[A-Za-z][A-Za-z0-9-]*$', 'Use letters, digits and hyphens, e.g. NO-TICKET.'), apply: (c, value) => { c.git.noTicketKey = value; } },
    { id: 'tickets.source', text: 'Ticket source (local, jira, linear)', default: (c) => c.tickets.source, check: matches('^(jira|linear|local)$', 'Use local, jira or linear.'), apply: setTicketSource },
    {
      id: 'tickets.site',
      when: (c) => c.tickets.source === 'jira',
      text: 'Jira site (host name, - to look it up on the first ticket)',
      default: (c) => c.tickets.site ?? '-',
      check: (value) => (value === '-' ? null : matches('^[a-z0-9.-]+\\.[a-z]+$', 'Use a host name such as your-company.atlassian.net, or - for none.')(value)),
      apply: (c, value) => { if (value === '-') delete c.tickets.site; else c.tickets.site = value; },
    },
    {
      id: 'tickets.contextPath',
      when: (c) => c.tickets.source === 'linear',
      text: 'Technical context per ticket, relative to the project root, with {key} (- for none)',
      default: (c) => c.tickets.contextPath ?? DEFAULT_CONTEXT_PATH,
      check: (value) => (value === '-' ? null : contextPathProblem(value)),
      apply: (c, value) => { if (value === '-') delete c.tickets.contextPath; else c.tickets.contextPath = value; },
    },
    {
      id: 'tickets.contextPath',
      when: (c) => c.tickets.source === 'local',
      text: 'Ticket files, relative to the project root, with {key}',
      default: (c) => c.tickets.contextPath ?? DEFAULT_LOCAL_TICKETS,
      check: contextPathProblem,
      apply: (c, value) => { c.tickets.contextPath = value; },
    },
  ];
}

// The questions whose when() holds for the config as it is now.
const activeQuestions = (questions, config) => questions.filter((question) => !question.when || question.when(config));

export const pendingQuestions = (config, detection) =>
  activeQuestions(questionsFor(config, detection), config).map((question) => ({ id: question.id, text: question.text, default: question.default(config, detection) }));

// Line-by-line answers from a terminal or a pipe; Enter or end of input takes the default.
export function createPrompter({ input, output }) {
  const rl = createInterface({ input, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(text, fallback, check = () => null) {
      for (;;) {
        output.write(`${text} [${fallback}]: `);
        const next = await lines.next();
        if (!input.isTTY) output.write('\n');
        const value = (next.done ? '' : next.value.trim()) || fallback;
        const problem = check(value);
        if (!problem || next.done) return problem ? fallback : value;
        output.write(`  ${problem}\n`);
      }
    },
    close: () => rl.close(),
  };
}

// Packs written as bare ids where nothing else is set.
const compactPacks = (config) => {
  config.packs = config.packs.map((entry) => (typeof entry === 'object' && Object.keys(entry).length === 1 ? entry.id : entry));
  return config;
};

export async function askQuestions(config, detection, { prompter = null, yes = false } = {}) {
  const result = structuredClone(config);
  for (const question of questionsFor(result, detection)) {
    // An earlier answer can switch a later question on or off (the ticket source).
    if (activeQuestions([question], result).length === 0) continue;
    const fallback = question.default(result, detection);
    question.apply(result, yes || !prompter ? fallback : await prompter.ask(question.text, fallback, question.check));
  }
  return compactPacks(result);
}

// --- settings, CLAUDE.md, bootstrap ------------------------------------------------------------

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const readTemplate = (name) => readFileSync(join(templatesDir, name), 'utf8');

// A check runs as one plain command; anything with shell syntax gets no allow rule.
const isPlainCommand = (command) => /^[A-Za-z0-9_./:@=+-]+(?: [A-Za-z0-9_./:@=+,-]+)*$/.test(command);

// The read-only git commands the agents run in the git -C form (status, diff, log, show; ls-files and
// the current branch for the orchestrator). Claude Code runs read-only git without a prompt only in
// the plain form; a trailing " *" also matches the bare command (code.claude.com/docs/en/permissions).
const READ_GIT = ['status *', 'diff *', 'log *', 'show *', 'ls-files *', 'rev-parse *', 'branch --show-current'];

// The allow rules for the git -C forms cw prints (§12, owner decisions 2026-10-20 and 2026-10-21),
// because Bash(git add *) does not match git -C … (code.claude.com/docs/en/permissions). In-place:
// add, commit and the read-only commands in the app root. A rule matches the command text as written,
// so it names the appRoot exactly as cw prints it: every appRoot that quote() leaves unquoted gets the
// rules; one that needs shell quoting gets none, only a warning. Worktree mode gets none: the worktree
// name is random, and a * in front of the subcommand would also approve options such as -c or
// --exec-path; the reviewer reads the worktree with cw review diff|log|show|status (ADR 0011).
export function gitAllowRules(config) {
  if ((config.workspace?.mode ?? 'worktree') !== 'in-place') return { rules: [], warning: null };
  const appRoot = normalizePackagePath(config.workspace.appRoot);
  if (quote(appRoot) !== appRoot) {
    return {
      rules: [],
      warning: `workspace.appRoot ${quote(appRoot)} needs shell quoting (only letters, digits and _ @ % + = : , . / - go unquoted), so cw init wrote no allow rule for git -C ${quote(appRoot)}: each git add, git commit and read-only git -C command of the agents asks for permission. Rename the directory to a name without such characters, set workspace.appRoot to it, and run cw init again.`,
    };
  }
  return { rules: ['add *', 'commit *', ...READ_GIT].map((command) => `Bash(git -C ${appRoot} ${command})`), warning: null };
}

// The §12 fragment: the permissions of the active packs (core always; node-npm adds the npm asks), the
// git -C allow rules, an allow rule per plain check command, the spawn depth, and the worktree settings
// in worktree mode. packs defaults to what the config resolves to.
export function settingsFragment({ config, detection, packs = null }) {
  const active = packs ?? resolvePacks({ configRoot: detection?.projectRoot ?? null, config: withDefaults(config) });
  const fragment = { permissions: packSettings(active), ...JSON.parse(readTemplate('settings-base.json')) };
  for (const rule of gitAllowRules(config).rules) {
    if (!fragment.permissions.allow.includes(rule)) fragment.permissions.allow.push(rule);
  }
  for (const pkg of config.packages) {
    for (const command of Object.values(pkg.checks ?? {})) {
      const rule = `Bash(${command} *)`;
      if (isPlainCommand(command) && !fragment.permissions.allow.includes(rule)) fragment.permissions.allow.push(rule);
    }
  }
  if ((config.workspace?.mode ?? 'worktree') === 'worktree') {
    const { worktree } = JSON.parse(readTemplate('settings-worktree.json'));
    worktree.symlinkDirectories = detection?.symlinkDirectories ?? ['node_modules'];
    fragment.worktree = worktree;
  }
  return fragment;
}

// Additive merge: new keys appended, arrays unioned (existing order first), objects recursed,
// differing scalars kept and reported.
export function mergeSettings(existing, fragment) {
  const merged = structuredClone(existing ?? {});
  const conflicts = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const walk = (target, source, path) => {
    for (const [key, value] of Object.entries(source)) {
      const here = path ? `${path}.${key}` : key;
      const current = target[key];
      if (current === undefined) target[key] = structuredClone(value);
      else if (Array.isArray(value) && Array.isArray(current)) {
        for (const item of value) if (!current.some((existingItem) => same(existingItem, item))) current.push(structuredClone(item));
      } else if (isObject(value) && isObject(current)) walk(current, value, here);
      else if (!same(current, value)) conflicts.push(`${here} (kept ${JSON.stringify(current)}, proposed ${JSON.stringify(value)})`);
    }
  };
  walk(merged, fragment, '');
  return { merged, conflicts, changed: !same(merged, existing ?? {}) };
}

// Replaces the text between the markers, or appends the marked section; nothing else changes.
export function upsertMarkedSection(text, section) {
  const block = `${MARKERS.start}\n${section.trim()}\n${MARKERS.end}`;
  const start = text.indexOf(MARKERS.start);
  const end = start === -1 ? -1 : text.indexOf(MARKERS.end, start);
  if (start !== -1 && end !== -1) return `${text.slice(0, start)}${block}${text.slice(end + MARKERS.end.length)}`;
  if (start !== -1 || text.includes(MARKERS.end)) {
    throw preconditionError('CLAUDE.md has only one of the dev-workflow markers.', `Restore both ${MARKERS.start} and ${MARKERS.end} around the section, or remove the stray one.`);
  }
  if (!text) return `${block}\n`;
  const gap = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return `${text}${gap}${block}\n`;
}

function sameJsonText(text, value) {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value);
  } catch {
    return false;
  }
}

// A symlinked file is written through to its target instead of replacing the link.
const throughLinks = (path) => (existsSync(path) && lstatSync(path).isSymbolicLink() ? realpathSync(path) : path);

// The rulebook of the config (cw rules build, §7), built in memory so that a pack or rules error fails
// cw init (exit 1) before anything is written. ws is { configRoot, config } with a normalized config.
export function compileRules(ws) {
  try {
    return buildRulebook(ws);
  } catch (error) {
    if (!(error instanceof CwError) || error.exitCode !== EXIT.failed) throw error;
    throw failedError(`${error.message}\nNothing was written.`, 'Correct the named files, or the packs and rules of the config, then run cw init again.', error.details);
  }
}

// Writes what changed and lists the files to commit; every read and check happens before any write.
export function writeProject({ projectRoot, config, detection, force = false }) {
  const errors = validateConfig(config);
  if (errors.length) throw failedError(`The config is invalid:\n${formatConfigErrors(errors)}`, 'Correct these fields, then run cw init again.', { errors });
  const configPath = join(projectRoot, CONFIG_RELATIVE);
  const configText = `${JSON.stringify(config, null, 2)}\n`;
  const currentConfig = readText(configPath);
  const sameConfig = currentConfig !== null && sameJsonText(currentConfig, config);
  if (currentConfig !== null && !sameConfig && !force) {
    throw preconditionError(`${configPath} exists and differs from the new config.`, 'Pass --force to replace it, or edit it by hand and run cw config validate.');
  }
  const ws = { configRoot: projectRoot, config: withDefaults(config) };
  const book = compileRules(ws);
  const ruleFiles = [...book.outputs.map((output) => `${OUT_DIR}/${output.file}`), LOCK_FILE];
  const rulesBefore = ruleFiles.map((file) => readText(join(projectRoot, file)));
  const foreign = ruleFiles.filter((file, i) => file !== LOCK_FILE && rulesBefore[i] !== null && !rulesBefore[i].includes(MARKER_PREFIX));
  if (foreign.length) {
    throw failedError(`${foreign.join(', ')} ${foreign.length === 1 ? 'exists and was' : 'exist and were'} not generated by cw; nothing was written.`, `Move or delete ${foreign.join(', ')}, then run cw init again.`);
  }
  const settingsPath = throughLinks(join(projectRoot, '.claude', 'settings.json'));
  const settingsText = readText(settingsPath);
  let settings = {};
  if (settingsText !== null) {
    try {
      settings = JSON.parse(settingsText);
    } catch (error) {
      throw preconditionError(`${settingsPath} is not valid JSON: ${error.message}`, 'Fix its JSON syntax, then run cw init again.');
    }
  }
  const { merged, conflicts, changed: settingsChanged } = mergeSettings(settings, settingsFragment({ config, detection, packs: book.packs }));
  const claudePath = throughLinks(join(projectRoot, 'CLAUDE.md'));
  const noTicketKey = config.git?.noTicketKey ?? loadPreset(config.git?.preset ?? 'default').noTicketKey;
  const claudeText = upsertMarkedSection(readText(claudePath, ''), render(readTemplate('claude-md-section.md'), { noTicketKey }));
  const scriptPath = join(projectRoot, BOOTSTRAP_RELATIVE);

  const changed = [];
  const put = (path, text) => {
    if (readText(path) === text) return;
    writeAtomic(path, text);
    changed.push(relative(projectRoot, path));
  };
  // An equal config keeps its bytes, so a hand-formatted file is not reformatted.
  if (!sameConfig) put(configPath, configText);
  // writeRulebook leaves equal outputs alone; the lock counts as changed only when its content does.
  const { deleted } = writeRulebook(ws, book);
  changed.push(...ruleFiles.filter((file, i) => readText(join(projectRoot, file)) !== rulesBefore[i]), ...deleted);
  if (settingsChanged) put(settingsPath, `${JSON.stringify(merged, null, 2)}\n`);
  put(claudePath, claudeText);
  put(scriptPath, readTemplate('setup-dev-workflow.sh'));
  chmodSync(scriptPath, 0o755);

  const warnings = [CONFIG_RELATIVE, join('.claude', 'settings.json')]
    .filter((path) => isIgnored(projectRoot, path))
    .map((path) => `git ignores ${path}; un-ignore it so the team shares it.`);
  const gitRulesWarning = gitAllowRules(config).warning;
  if (gitRulesWarning) warnings.push(gitRulesWarning);
  const files = [relative(projectRoot, configPath), ...ruleFiles, ...[settingsPath, claudePath, scriptPath].map((path) => relative(projectRoot, path))];
  return { projectRoot, files, changed, conflicts, warnings: [...book.warnings, ...warnings] };
}
