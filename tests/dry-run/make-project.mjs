#!/usr/bin/env node
// Creates a throwaway project for the dev-workflow dry run (docs/dry-run.md, docs/PLAN.md §14 P3):
// Acme Shop's layout with a tiny npm-workspaces application (packages/web: React 19, Vite,
// Vitest, Testing Library; packages/api: Express 5, TypeScript, Vitest, supertest, ESLint), a local
// bare origin whose fetch URL names a GitHub or GitLab repository while pushes land in the bare repo,
// gh and glab stubs, and a launcher for the Claude Code CLI. The dev-workflow files come from cw itself
// (cw init --detect, then cw init --write). It runs no npm and needs no network; it prints the npm
// command for you. Run it in your own terminal: cw init refuses to write inside Claude Code.
//
//   node tests/dry-run/make-project.mjs <target dir> [--mode in-place|worktree] [--host github|gitlab]
//
// in-place: <target> is the outer repo, the application is the nested repo <target>/app (ignored by
// the outer repo). worktree: <target> is a single repo holding the application and the config. The kit
// lives in <target>/.dry-run/ (ignored): origin.git, bin/{gh,glab}, start-cli.sh, init-config.json.
// Exit codes as cw: 0 ok, 1 a step failed, 2 usage error, 3 precondition not met.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginDir = join(repoRoot, 'plugins', 'dev-workflow');
const cwScript = join(pluginDir, 'cli', 'cw.mjs');

const EXIT = { ok: 0, failed: 1, usage: 2, precondition: 3 };
const USAGE = 'node tests/dry-run/make-project.mjs <target dir> [--mode in-place|worktree] [--host github|gitlab]';
const MODES = ['in-place', 'worktree'];

// The fetch URL is what cw reads to pick the host and build the PR/MR commands; the stubs answer for
// that repository. gitlab.example.com never resolves to a real GitLab, so nothing reaches a real host.
export const HOSTS = {
  github: { fetchUrl: 'git@github.com:acme/dry-run.git', prUrl: 'https://github.com/acme/dry-run/pull/1' },
  gitlab: { fetchUrl: 'git@gitlab.example.com:acme/dry-run.git', prUrl: 'https://gitlab.example.com/acme/dry-run/-/merge_requests/1' },
};

class KitError extends Error {
  constructor(code, message, fix) {
    super(message);
    this.code = code;
    this.fix = fix;
  }
}

// Single-quotes an argument for sh, bash, zsh and fish unless it is a plain word.
const quote = (arg) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

function write(root, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
}

// --- the application ------------------------------------------------------------------------------

const ESLINT_DEPS = { '@eslint/js': '^9.29.0', eslint: '^9.29.0', globals: '^16.2.0', 'typescript-eslint': '^8.34.0' };

const eslintConfig = (globalsName) => `import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.${globalsName} },
    rules: {
      // Express recognises its error handler by four parameters, so unused ones are named _x.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
`;

const API_FILES = {
  'packages/api/package.json': {
    name: '@dry-run/api',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: { test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit' },
    dependencies: { express: '^5.1.0' },
    devDependencies: {
      ...ESLINT_DEPS,
      '@types/express': '^5.0.3',
      '@types/node': '^22.15.0',
      '@types/supertest': '^6.0.3',
      supertest: '^7.1.1',
      typescript: '^5.8.3',
      vitest: '^3.2.4',
    },
  },
  'packages/api/tsconfig.json': {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
      types: ['node'],
    },
    include: ['src'],
  },
  'packages/api/eslint.config.js': eslintConfig('node'),
  'packages/api/src/app.ts': `import express, { type NextFunction, type Request, type Response } from 'express';

const vehicles = [
  { id: 'city-car', name: 'City car', pricePerDay: 39 },
  { id: 'van', name: 'Van', pricePerDay: 59 },
];

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/vehicles', (_req, res) => {
    return res.json(vehicles);
  });

  app.use((_req, res) => {
    return res.status(404).json({ error: 'Not found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
`,
  'packages/api/src/server.ts': `import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);

createApp().listen(port, () => {
  console.log(\`API listening on http://localhost:\${port}\`);
});
`,
  'packages/api/src/app.test.ts': `import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('GET /api/vehicles', () => {
  it('lists the vehicles with their daily price', async () => {
    const response = await request(createApp()).get('/api/vehicles');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 'city-car', name: 'City car', pricePerDay: 39 },
      { id: 'van', name: 'Van', pricePerDay: 59 },
    ]);
  });
});
`,
};

// The product copy is German, as in Acme Shop (project.language.productCopy "de").
const WEB_FILES = {
  'packages/web/package.json': {
    name: '@dry-run/web',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit' },
    dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' },
    devDependencies: {
      ...ESLINT_DEPS,
      '@testing-library/dom': '^10.4.0',
      '@testing-library/react': '^16.3.0',
      '@types/react': '^19.1.0',
      '@types/react-dom': '^19.1.0',
      '@vitejs/plugin-react': '^4.5.0',
      jsdom: '^26.1.0',
      typescript: '^5.8.3',
      vite: '^6.3.0',
      vitest: '^3.2.4',
    },
  },
  'packages/web/tsconfig.json': {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ['src'],
  },
  'packages/web/eslint.config.js': eslintConfig('browser'),
  'packages/web/vite.config.ts': `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom' },
});
`,
  'packages/web/index.html': `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fahrzeug mieten</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  'packages/web/src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  'packages/web/src/App.tsx': `export function App() {
  return (
    <main>
      <h1>Fahrzeug mieten</h1>
      <p>Wähle ein Fahrzeug für deine nächste Fahrt.</p>
    </main>
  );
}
`,
  'packages/web/src/App.test.tsx': `import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('App', () => {
  it('shows the page heading', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Fahrzeug mieten');
  });
});
`,
};

const APP_FILES = {
  'package.json': { name: 'dry-run-app', version: '0.0.0', private: true, workspaces: ['packages/*'] },
  ...API_FILES,
  ...WEB_FILES,
};

const claudeMd = (mode) => `# Dry Run

A throwaway project for the dev-workflow dry run (docs/dry-run.md in the claude-tools repository).
${mode === 'in-place'
    ? 'The application lives in `app/`, a git repository of its own that this repository ignores (in-place mode).'
    : 'The application is this repository (worktree mode).'}

Everything in the repository is English; user-facing product copy is German.
`;

const README = `# Dry Run

Generated by \`tests/dry-run/make-project.mjs\` of the claude-tools repository; follow its \`docs/dry-run.md\`.
`;

// --- the kit ---------------------------------------------------------------------------------------

// The stubs use nothing but process, so they run whether Node reads them as CommonJS or as ESM.
const ghStub = `#!/usr/bin/env node
// gh stub of the dev-workflow dry run: no pull request exists, and "gh pr create" prints a made-up URL
// instead of creating one. Nothing leaves this machine.
const args = process.argv.slice(2);
process.stderr.write('[dry-run stub] gh ' + args.join(' ') + '\\n');
if (args[0] === 'pr' && args[1] === 'view') {
  process.stderr.write('no pull requests found for branch "' + (args[2] ?? '') + '"\\n');
  process.exitCode = 1;
} else if (args[0] === 'pr' && args[1] === 'create') {
  process.stdout.write(${JSON.stringify(`${HOSTS.github.prUrl}\n`)});
} else {
  process.stderr.write('The dry-run stub answers only "gh pr view" and "gh pr create".\\n');
  process.exitCode = 1;
}
`;

const glabStub = `#!/usr/bin/env node
// glab stub of the dev-workflow dry run: no merge request exists, and "glab mr create" prints a made-up
// URL instead of creating one. Nothing leaves this machine.
const args = process.argv.slice(2);
process.stderr.write('[dry-run stub] glab ' + args.join(' ') + '\\n');
if (args[0] === 'mr' && args[1] === 'view') {
  process.stderr.write('no merge request found for branch "' + (args[2] ?? '') + '"\\n');
  process.exitCode = 1;
} else if (args[0] === 'mr' && args[1] === 'list') {
  process.stdout.write('[]\\n');
} else if (args[0] === 'mr' && args[1] === 'create') {
  process.stdout.write(${JSON.stringify(`${HOSTS.gitlab.prUrl}\n`)});
} else {
  process.stderr.write('The dry-run stub answers only "glab mr view", "glab mr list" and "glab mr create".\\n');
  process.exitCode = 1;
}
`;

const launcher = ({ projectRoot, binDir }) => `#!/bin/sh
# Starts the Claude Code CLI for the dev-workflow dry run (docs/dry-run.md): in the project root, with
# the gh and glab stubs first on PATH and the dev-workflow plugin loaded from the checkout that
# generated this project. Arguments are passed on to claude.
cd ${quote(projectRoot)} || exit 1
PATH=${quote(binDir)}:$PATH
export PATH
exec claude --plugin-dir ${quote(pluginDir)} "$@"
`;

// --- steps -----------------------------------------------------------------------------------------

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { mode: { type: 'string', default: 'in-place' }, host: { type: 'string', default: 'github' }, help: { type: 'boolean' } },
    });
  } catch (error) {
    throw new KitError(EXIT.usage, error.message, `Usage: ${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (values.help) return { help: true };
  if (positionals.length !== 1) throw new KitError(EXIT.usage, 'Pass exactly one target directory.', `Usage: ${USAGE}`);
  if (!MODES.includes(values.mode)) throw new KitError(EXIT.usage, `Unknown --mode ${values.mode}.`, 'Use --mode in-place or --mode worktree.');
  if (!HOSTS[values.host]) throw new KitError(EXIT.usage, `Unknown --host ${values.host}.`, 'Use --host github or --host gitlab.');
  return { target: resolve(positionals[0]), mode: values.mode, host: values.host };
}

function checkPreconditions(target, env) {
  if (env.CLAUDECODE === '1') {
    throw new KitError(EXIT.precondition, 'make-project runs cw init --write, which refuses inside Claude Code (CLAUDECODE=1).', 'Run make-project in your own terminal.');
  }
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) throw new KitError(EXIT.precondition, `Node ${process.versions.node} is too old.`, 'Install Node 20 or later.');
  const version = spawnSync('git', ['--version'], { env, encoding: 'utf8' });
  if (version.error || version.status !== 0) throw new KitError(EXIT.precondition, 'git is not on PATH.', 'Install git 2.31 or later.');
  if (existsSync(target)) {
    if (!statSync(target).isDirectory()) throw new KitError(EXIT.precondition, `${target} is a file.`, 'Pass a directory that does not exist yet.');
    if (readdirSync(target).length) throw new KitError(EXIT.precondition, `${target} is not empty.`, 'Pass a directory that does not exist yet or is empty.');
  }
  let existing = target;
  while (!existsSync(existing)) existing = dirname(existing);
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: existing, env, encoding: 'utf8' });
  if (top.status === 0) {
    throw new KitError(EXIT.precondition, `${target} is inside the git repository ${top.stdout.trim()}; cw would see the project as nested there.`, 'Pass a directory outside any git repository, e.g. ~/dry-run/<name>.');
  }
}

function main(argv, env) {
  const options = parse(argv);
  if (options.help) {
    console.log(`Usage: ${USAGE}`);
    return EXIT.ok;
  }
  const { mode, host } = options;
  checkPreconditions(options.target, env);
  mkdirSync(options.target, { recursive: true });
  const target = realpathSync(options.target);
  const startOver = `Remove ${target}, fix the cause, and run make-project again.`;

  const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() || result.error?.message || `exit ${result.status}`;
      throw new KitError(EXIT.failed, `${command === process.execPath ? 'cw' : command} ${args.join(' ')} failed in ${cwd}:\n${output}`, startOver);
    }
    return result;
  };
  const git = (cwd, ...args) => run('git', args, cwd).stdout;
  const cw = (cwd, ...args) => run(process.execPath, [cwScript, ...args], cwd);

  const projectRoot = target;
  const workRepo = mode === 'in-place' ? join(target, 'app') : target;
  const kitDir = join(target, '.dry-run');
  const binDir = join(kitDir, 'bin');
  const bare = join(kitDir, 'origin.git');

  // The kit, ignored by the project repository.
  write(kitDir, { 'bin/gh': ghStub, 'bin/glab': glabStub, 'start-cli.sh': launcher({ projectRoot, binDir }) });
  for (const file of ['bin/gh', 'bin/glab', 'start-cli.sh']) chmodSync(join(kitDir, file), 0o755);

  // The application repository, its bare origin and the first push (it also creates origin/main).
  // The project repository ignores .claude/settings.local.json, where /sandbox saves its mode
  // (code.claude.com/docs/en/sandboxing), so a dry-run session leaves its status clean.
  const ignored = ['node_modules/', 'dist/', '.DS_Store'];
  const appFiles = mode === 'in-place'
    ? { ...APP_FILES, '.gitignore': `${ignored.join('\n')}\n` }
    : { ...APP_FILES, '.gitignore': `${[...ignored, '.dry-run/', '.claude/worktrees/', '.claude/settings.local.json'].join('\n')}\n`, 'README.md': README, 'CLAUDE.md': claudeMd(mode) };
  write(workRepo, appFiles);
  git(workRepo, 'init', '-q', '-b', 'main');
  git(workRepo, 'add', '-A');
  git(workRepo, 'commit', '-q', '-m', '[TASK] Add the dry-run application');
  git(kitDir, 'init', '-q', '--bare', '-b', 'main', bare);
  git(workRepo, 'remote', 'add', 'origin', HOSTS[host].fetchUrl);
  git(workRepo, 'config', 'remote.origin.pushurl', bare);
  git(workRepo, 'push', '-q', 'origin', 'main');

  if (mode === 'in-place') {
    write(projectRoot, { '.gitignore': 'app/\n.dry-run/\n.DS_Store\n.claude/settings.local.json\n', 'README.md': README, 'CLAUDE.md': claudeMd(mode) });
    git(projectRoot, 'init', '-q', '-b', 'main');
  }

  // The dev-workflow files from cw: its proposal for this layout, with the project's own choices.
  const detection = JSON.parse(cw(projectRoot, 'init', '--detect', '--json').stdout);
  const config = detection.config;
  config.project = { ...config.project, name: 'Dry Run', language: { repo: 'en', productCopy: 'de' } };
  config.git = { ...config.git, noTicketKey: 'NO-TICKET' };
  const configFile = join(kitDir, 'init-config.json');
  write(kitDir, { 'init-config.json': config });
  const init = cw(projectRoot, 'init', '--write', configFile);

  git(projectRoot, 'add', '-A');
  git(projectRoot, 'commit', '-q', '-m', mode === 'in-place' ? '[TASK] Set up the dry-run project' : '[TASK] Set up dev-workflow');
  if (mode === 'worktree') git(projectRoot, 'push', '-q', 'origin', 'main');

  const packs = config.packs.map((entry) => (typeof entry === 'string' ? entry : `${entry.id}${entry.variant ? ` (${entry.variant})` : ''}`));
  // make-project committed the files and names its own next steps.
  const initLines = `${init.stderr}${init.stdout}`.trim().split('\n').filter((line) => !/^(Files to commit|Next):/.test(line));
  const cwCommand = `node ${quote(cwScript)}`;
  const lines = [
    `Created the dry-run project (${mode}, ${host}) in ${target}.`,
    mode === 'in-place' ? `  Application repo: ${workRepo}` : `  Application repo: ${workRepo} (also the config root)`,
    `  origin: fetch ${HOSTS[host].fetchUrl}, push ${bare}`,
    `  Packs: ${packs.join(', ')}; packages: ${config.packages.map((pkg) => `${pkg.id} (${pkg.path})`).join(', ')}`,
    `  gh and glab stubs: ${binDir}`,
    '',
    'cw init --write said:',
    ...initLines.map((line) => `  ${line}`),
    '',
    'Next, in your own terminal (make-project runs no npm):',
    '  1. Install the dependencies and commit the lockfile:',
    `     cd ${quote(workRepo)}`,
    '     npm install',
    '     git add package-lock.json',
    `     git commit -m ${quote('[TASK] Add the npm lockfile')}`,
    '     git push origin main',
    '  2. Check the project: every check passes and cw doctor reports no error:',
    `     cd ${quote(projectRoot)}`,
    `     ${cwCommand} checks`,
    `     ${cwCommand} doctor`,
    '  3. Start the Claude Code CLI with the plugin and the stubs:',
    `     ${quote(join(kitDir, 'start-cli.sh'))}`,
    'Then follow docs/dry-run.md.',
  ];
  console.log(lines.join('\n'));
  return EXIT.ok;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2), process.env);
  } catch (error) {
    if (!(error instanceof KitError)) throw error;
    console.error(`make-project: ${error.message}\nFix: ${error.fix}`);
    process.exitCode = error.code;
  }
}
