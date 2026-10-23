import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { validateConfig, withDefaults } from '../../cli/lib/config.mjs';
import { adapterFor, pushCommand } from '../../cli/lib/host/index.mjs';
import {
  detectPacks, invalidPlaceholder, listAvailablePacks, loadProcedures, packComplexityRules, packGuards, packScript, packSettings, readPackManifest,
  renderPlaceholders, resolvePacks, resolvePlaceholders, runPackScript, scopeScripts, singleTestCommand, singleTestTemplateError, testRunnerOf, validatePackManifest,
} from '../../cli/lib/packs.mjs';
import { parseRuleFile } from '../../cli/lib/rules.mjs';
import { loadSchema } from '../../cli/lib/schema.mjs';
import { pluginRoot, tempBase, write } from '../fixtures/repo.mjs';

// The node-npm pack's dependency commands: npm's own aliases (npm <command> --help, npm 11.6.2).
const NPM_DEPENDENCY_COMMANDS = [
  'npm install', 'npm i', 'npm add', 'npm in', 'npm ins', 'npm inst', 'npm insta', 'npm instal', 'npm isnt', 'npm isnta', 'npm isntal', 'npm isntall',
  'npm ci', 'npm clean-install', 'npm ic', 'npm install-clean', 'npm isntall-clean',
  'npm uninstall', 'npm unlink', 'npm remove', 'npm rm', 'npm r', 'npm un',
  'npm update', 'npm up', 'npm upgrade', 'npm udpate',
  'npm install-test', 'npm it', 'npm install-ci-test', 'npm cit', 'npm clean-install-test', 'npm sit',
  'npm audit fix',
];
// Its ask rules: every command that installs or removes packages (update and audit fix stay unasked, as before).
const NPM_ASK = [
  'npm ci', 'npm install', 'npm i', 'npm uninstall',
  'npm add', 'npm in', 'npm ins', 'npm inst', 'npm insta', 'npm instal', 'npm isnt', 'npm isnta', 'npm isntal', 'npm isntall',
  'npm clean-install', 'npm ic', 'npm install-clean', 'npm isntall-clean',
  'npm unlink', 'npm remove', 'npm rm', 'npm r', 'npm un',
  'npm install-test', 'npm it', 'npm install-ci-test', 'npm cit', 'npm clean-install-test', 'npm sit',
].map((command) => `Bash(${command} *)`);

const MM_PACKS = [
  'node-npm',
  { id: 'typescript', options: { moduleResolution: 'nodenext' } },
  { id: 'express', variant: '5', options: { appEntry: 'createApp()' } },
  { id: 'react-vite', variant: 'react-19', options: { vitestGlobals: false } },
  'vitest',
];

// A workspace-like object: resolvePacks and loadProcedures read only configRoot and config.
const wsWith = (configRoot, packs = MM_PACKS, extra = {}) => ({
  configRoot,
  config: withDefaults({ version: 1, project: { name: 'Fixture' }, packs, packages: [{ id: 'app', path: '.', areas: ['frontend', 'backend'] }], ...extra }),
});

// Every rule ID in the pack's base and variant files.
const packRuleIds = (pack) =>
  [pack.manifest.rules, ...Object.values(pack.manifest.variants ?? {}).map((variant) => variant.rules)]
    .filter(Boolean)
    .flatMap((file) => parseRuleFile(readFileSync(join(pack.root, file), 'utf8'), file).map((rule) => rule.id));

const resolveError = (ws) => {
  try {
    resolvePacks(ws);
  } catch (error) {
    return error;
  }
  return assert.fail('resolvePacks did not throw');
};

test('every bundled pack is valid: manifest, rules, scripts and procedures', (t) => {
  const packsDir = join(pluginRoot, 'packs');
  const ids = readdirSync(packsDir).sort();
  assert.deepEqual(ids, ['core', 'express', 'node-npm', 'react-vite', 'typescript', 'vitest']);
  for (const id of ids) {
    const manifest = readPackManifest(join(packsDir, id));
    assert.equal(manifest.id, id);
    for (const file of [manifest.rules, ...Object.values(manifest.variants ?? {}).map((variant) => variant.rules)].filter(Boolean)) {
      assert.ok(parseRuleFile(readFileSync(join(packsDir, id, file), 'utf8'), `${id}/${file}`).length > 0, `${id}/${file}`);
    }
  }
  const ws = wsWith(tempBase(t));
  const packs = resolvePacks(ws);
  const warnings = [];
  const procedures = loadProcedures(ws, packs, { onWarning: (warning) => warnings.push(warning) });
  assert.deepEqual(warnings, []);
  assert.deepEqual(procedures.map((procedure) => `${procedure.origin}:${procedure.role}/${procedure.name}`), [
    'typescript:implementer/narrow-unknown',
    'express:implementer/express-route',
    'react-vite:implementer/ui-change',
    'react-vite:reviewer/ui-review',
  ]);
  for (const procedure of procedures) {
    const own = new Set([...packRuleIds(packs.find((pack) => pack.id === procedure.origin)), ...packRuleIds(packs[0])]);
    for (const id of procedure.rules) assert.ok(own.has(id), `${procedure.name} names ${id}, which is not in its pack or core`);
    assert.ok(!procedure.body.includes('{options.'), procedure.name);
  }
});

test('the pack schema documents exactly the keys the validator accepts', () => {
  const keys = Object.keys(loadSchema('pack').properties).sort();
  assert.deepEqual(keys, [
    'areas', 'checkDiscovery', 'complexity', 'conflicts', 'defaultVariant', 'description', 'detect', 'guards', 'id', 'options',
    'requires', 'rules', 'scopeScripts', 'scripts', 'settings', 'testRunner', 'title', 'variants', 'version',
  ]);
  const base = { id: 'x', version: '0.1.0', title: 'X' };
  assert.deepEqual(validatePackManifest(base, 'x'), []);
  const messages = (manifest, dir = 'x') => validatePackManifest(manifest, dir).map((error) => `${error.path}: ${error.message}`);
  assert.match(messages({ ...base, playbooks: {} }).join('\n'), /\$\.playbooks: is not allowed/);
  assert.match(messages(base, 'y').join('\n'), /\$\.id: must equal the directory name "y"/);
  assert.match(messages({ ...base, variants: { a: { description: 'A' } }, defaultVariant: 'b' }).join('\n'), /defaultVariant: must name a variant \(a\)/);
  assert.match(messages({ ...base, checkDiscovery: 'nope' }).join('\n'), /checkDiscovery: must name a script/);
  assert.match(messages({ ...base, scripts: { a: 'scripts/a.mjs' }, scopeScripts: ['b'] }).join('\n'), /scopeScripts\[0\]: must name a script \(a\)/);
  assert.match(messages({ ...base, options: { flag: { type: 'boolean', default: 'true', description: 'd' } } }).join('\n'), /options\.flag\.default: must be a boolean/);
  assert.match(messages({ ...base, testRunner: { single: 'jest' } }).join('\n'), /must contain \{file\}/);
  assert.match(messages({ ...base, testRunner: { single: 'jest {file} -t {name}' } }).join('\n'), /\{name\} must sit inside/);
  assert.match(messages({ ...base, detect: [{ glob: 'a', dependency: 'b' }] }).join('\n'), /detect\[0\]: must match exactly one/);
});

test('resolvePacks puts core first, adds requires before their dependent and shadows bundled packs', (t) => {
  const root = tempBase(t);
  write(root, {
    '.claude/dev-workflow/packs/base-lib/pack.json': { id: 'base-lib', version: '0.1.0', title: 'Base' },
    '.claude/dev-workflow/packs/app-lib/pack.json': { id: 'app-lib', version: '0.1.0', title: 'App', requires: ['base-lib'] },
    '.claude/dev-workflow/packs/vitest/pack.json': { id: 'vitest', version: '9.0.0', title: 'Local vitest', testRunner: { single: 'node --test {file}' } },
  });
  const warnings = [];
  const packs = resolvePacks(wsWith(root, ['vitest', 'app-lib', 'core']), { onWarning: (warning) => warnings.push(warning) });
  assert.deepEqual(packs.map((pack) => pack.id), ['core', 'vitest', 'base-lib', 'app-lib']);
  assert.equal(packs[1].source, 'project');
  assert.equal(packs[1].shadows, true);
  assert.deepEqual(testRunnerOf(packs), { pack: 'vitest', single: 'node --test {file}' });
  assert.equal(warnings.length, 2);
  assert.match(warnings.join('\n'), /project pack vitest .* shadows the bundled pack vitest/);
  assert.match(warnings.join('\n'), /pack base-lib added because app-lib requires it; add it to packs/);
  assert.deepEqual(listAvailablePacks(root), ['app-lib', 'base-lib', 'core', 'express', 'node-npm', 'react-vite', 'typescript', 'vitest']);
});

test('resolvePacks reports every problem of one call in one error', (t) => {
  const root = tempBase(t);
  write(root, {
    '.claude/dev-workflow/packs/loop-a/pack.json': { id: 'loop-a', version: '0.1.0', title: 'A', requires: ['loop-b'] },
    '.claude/dev-workflow/packs/loop-b/pack.json': { id: 'loop-b', version: '0.1.0', title: 'B', requires: ['loop-a'] },
    '.claude/dev-workflow/packs/rival/pack.json': { id: 'rival', version: '0.1.0', title: 'R', conflicts: ['vitest'] },
    '.claude/dev-workflow/packs/misnamed/pack.json': { id: 'other', version: '0.1.0', title: 'M' },
  });
  const error = resolveError(wsWith(root, [
    'nope',
    { id: 'express', variant: '6' },
    { id: 'react-vite', options: { vitestGlobals: 'true', colour: 'x' } },
    'loop-a',
    'rival',
    'vitest',
    'misnamed',
  ]));
  assert.equal(error.exitCode, 1);
  const text = error.message;
  assert.match(text, /^Pack resolution failed:/);
  assert.match(text, /pack nope not found \(looked in \.claude\/dev-workflow\/packs\/nope and the plugin\)\. Available: .*express.*vitest/);
  assert.match(text, /pack express: unknown variant 6 \(known: 4, 5\)/);
  assert.match(text, /pack express: option appEntry is required\. Add it: \{ "id": "express", "options": \{ "appEntry": … \} \}/);
  assert.match(text, /pack react-vite: option vitestGlobals must be a boolean \(got "true"\)/);
  assert.match(text, /pack react-vite: unknown option colour \(known: vitestGlobals\)/);
  assert.match(text, /circular requires: loop-a -> loop-b -> loop-a/);
  assert.match(text, /pack rival conflicts with pack vitest/);
  assert.match(text, /misnamed\/pack\.json: \$\.id: must equal the directory name "misnamed"/);
  assert.match(error.fix, /config\.json/);
});

test('placeholders: only options, ruleOptions and project; arrays joined; values never re-rendered', () => {
  const values = { options: { a: ['x', 'y'], loop: '{options.a}' }, project: { language: { repo: 'en' } } };
  assert.equal(renderPlaceholders('{options.a} and {project.language.repo}', values), 'x, y and en');
  const literal = "'/items{/:id}' {a,b} {file} { \"error\": \"<message>\" }";
  assert.equal(renderPlaceholders(literal, values), literal);
  assert.deepEqual(resolvePlaceholders('{options.appEntry} {ruleOptions.max} {project.x} {file}', {}).unresolved, ['{options.appEntry}', '{ruleOptions.max}', '{project.x}']);
  const { text, unresolved } = resolvePlaceholders('{options.loop}', values);
  assert.equal(text, '{options.a}');
  assert.deepEqual(unresolved, []);
});

test('placeholders: a token of those namespaces with other characters is reported as invalid', () => {
  const values = { options: { 'max-items': 3, a: '{options.b-c}' }, project: { name: 'P' } };
  const result = resolvePlaceholders('{options.max-items} {project.owner-team} {options.} {project.name} {options.a} {file} {a-b}', values);
  assert.deepEqual(result.invalid, ['{options.max-items}', '{project.owner-team}', '{options.}']);
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.text, '{options.max-items} {project.owner-team} {options.} P {options.b-c} {file} {a-b}', 'a substituted value is not scanned');
});

test('invalidPlaceholder names the fix per namespace: the project placeholders, or the option to rename', () => {
  const project = invalidPlaceholder('{project.owner-team}');
  assert.match(project, /^invalid placeholder \{project\.owner-team\}: the names after the dot may use only letters, digits and _\. Correct it to one of the project placeholders: \{project\.name\}, \{project\.language\.repo\}, \{project\.language\.productCopy\}$/);
  assert.doesNotMatch(project, /option/);
  for (const token of ['{options.max-items}', '{ruleOptions.max-items}', '{options.}']) {
    assert.match(invalidPlaceholder(token), /\. Correct it, and rename the option it refers to if there is one \(e\.g\. max-items to max_items\)$/, token);
  }
});

test('globs in packs are checked when the pack resolves: complexity paths with their options, detect globs', (t) => {
  const root = tempBase(t);
  write(root, {
    '.claude/dev-workflow/packs/db/pack.json': {
      id: 'db', version: '0.1.0', title: 'DB',
      options: { migrations: { type: 'string', default: 'db/[z-a]', description: 'd' } },
      complexity: { escalate: [{ paths: ['{options.migrations}/**'], min: 'l', reason: 'schema change' }] },
    },
    '.claude/dev-workflow/packs/legacy/pack.json': { id: 'legacy', version: '0.1.0', title: 'Legacy', complexity: { escalate: [{ paths: ['db/[legacy/**'], min: 'm', reason: 'legacy' }] } },
  });
  const error = resolveError(wsWith(root, ['db', 'legacy']));
  assert.equal(error.exitCode, 1);
  assert.match(error.message, /pack db: complexity\.escalate\[0\]\.paths\[0\] db\/\[z-a\]\/\*\*: invalid \[ … \] class \(Range out of order in character class\)/);
  // Only cw matches these globs, so the message says nothing about Claude Code.
  assert.match(error.message, /pack legacy: complexity\.escalate\[0\]\.paths\[0\] db\/\[legacy\/\*\*: unclosed "\[": escape a literal \[ as \\\[$/m);
  assert.equal(resolvePacks(wsWith(root, [{ id: 'db', options: { migrations: 'db/\\[2024\\]' } }])).length, 2);

  const messages = validatePackManifest({ id: 'x', version: '0.1.0', title: 'X', detect: [{ glob: 'a/[b' }], variants: { v: { description: 'V', detect: [{ glob: '[z-a]' }] } } }, 'x')
    .map((item) => `${item.path}: ${item.message}`).join('\n');
  assert.match(messages, /^\$\.detect\[0\]\.glob: unclosed "\[": escape a literal \[ as \\\[$/m);
  assert.match(messages, /\$\.variants\.v\.detect\[0\]\.glob: invalid \[ … \] class/);
});

test('singleTestCommand: the optional name segment, regex-escaped names and shell quoting', () => {
  const vitest = 'npx vitest run {file} [-t "{name}"]';
  assert.equal(singleTestCommand(vitest, { file: 'src/a.test.ts' }), 'npx vitest run src/a.test.ts');
  assert.equal(singleTestCommand(vitest, { file: 'src/a.test.ts', name: 'adds (x)' }), "npx vitest run src/a.test.ts -t 'adds \\(x\\)'");
  assert.equal(singleTestCommand('node --test {file}', { file: "it's.test.mjs" }), `node --test 'it'\\''s.test.mjs'`);
  const tricky = `it's "$HOME" \`x\` (1+1)`;
  const echoed = spawnSync('sh', ['-c', singleTestCommand('printf %s "{name}" # {file}', { file: 'f', name: tricky })], { encoding: 'utf8' });
  assert.equal(echoed.stdout, tricky.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'the regex-escaped name reaches the command unchanged');
  assert.throws(() => singleTestCommand('node --test {file}', { file: 'a.test.mjs', name: 'x' }), (error) => error.exitCode === 2 && /without ::<name>/.test(error.fix));
  assert.throws(() => singleTestCommand('runner --grep {name} {file}', { file: 'a' }), (error) => error.exitCode === 2 && /needs a test name/.test(error.message));
});

test('a {file} only inside the optional name segment is refused: without a name the proof would run the whole suite', () => {
  assert.match(singleTestTemplateError('npx vitest run [-t {name} {file}]'), /must contain \{file\} outside the optional/);
  assert.equal(singleTestTemplateError('npx vitest run {file} [-t "{name}"]'), null);
  assert.throws(() => singleTestCommand('npx vitest run [-t {name} {file}]', { file: 'src/a.test.ts' }), (error) => error.exitCode === 3 && /outside the optional/.test(error.message));
});

test('singleTestCommand refuses a template without {file}: the proof would run the whole suite', () => {
  assert.throws(() => singleTestCommand('npm test', { file: 'src/a.test.mjs' }), (error) => error.exitCode === 3
    && error.message === 'The single-test command "npm test" must contain {file} (without it a proof runs the whole suite).'
    && /Correct packages\[\]\.testSingle in \.claude\/dev-workflow\/config\.json/.test(error.fix));
});

test('single-test templates: a placeholder inside a longer quoted word, next to a quote or after a \\ is refused; quoted alone or unquoted it is safe', (t) => {
  const file = 'src/$(touch PWNED).test.mjs';
  const refused = [
    'node --test "./{file}"', "node --test './{file}'", 'node --test {file} --test-name-pattern="^{name}$"', 'node --test \\{file}', 'node --test "{file}',
    // A quote next to an unquoted placeholder: "a"{file}"b" was rendered as "a'<file>'b", the value inside double quotes.
    'printf %s "a"{file}"b"', 'printf %s ""{file}""', "printf %s 'a'{file}'b'", 'printf %s \\"{file}\\"', 'printf %s "./"{file}', 'printf %s {file} [-t "a"{name}"b"]',
    // bash's ANSI-C and locale quoting: a backslash-escaped quote does not close $'…'.
    "printf %s $'{file}'", 'printf %s $"{file}"', 'printf %s ${file}',
    // Read as written it is fine, but without a name the segment ends inside "x]" and leaves a quote next to {file}.
    `printf %s {file} [-t '{name}' "x]"`,
  ];
  const base = tempBase(t);
  for (const template of refused) {
    const name = template.includes('{name}') ? 'adds `touch NAMED` two' : null;
    // A rendered command goes through sh, as cw prove runs it.
    let outcome;
    try {
      outcome = singleTestCommand(template, { file, name });
      spawnSync('sh', ['-c', outcome], { cwd: base, encoding: 'utf8' });
    } catch (error) {
      outcome = error;
    }
    assert.deepEqual(readdirSync(base), [], `${template} rendered ${outcome}`);
    assert.ok(outcome.exitCode === 3 && /inside a longer quoted word, next to a quote or after a \\ or \$/.test(outcome.message), `${template}: ${outcome}`);
    assert.match(validatePackManifest({ id: 'x', version: '0.1.0', title: 'X', testRunner: { single: template } }, 'x').map((error) => error.message).join('\n'), /inside a longer quoted word/, template);
    const config = { version: 1, project: { name: 'F' }, packs: [], packages: [{ id: 'a', path: '.', areas: ['backend'], testSingle: template }] };
    assert.match(validateConfig(config).map((error) => error.message).join('\n'), /inside a longer quoted word, next to a quote/, template);
  }
  const safe = [
    ['printf %s {file}', file], ['printf %s "{file}"', file], ["printf %s '{file}'", file], ['printf %s ./{file}', `./${file}`], ['printf %s {file} [--name="{name}"]', file],
    // Quotes next to a placeholder quoted on its own: only its own quotes give way to the quoted value.
    ['printf %s "{file}""b"', `${file}b`], ["printf %s 'a'\"{file}\"", `a${file}`], ['printf %s "a" "{file}" "b"', `a${file}b`], ['printf %s a{file}b', `a${file}b`],
  ];
  for (const [template, expected] of safe) {
    const printed = spawnSync('sh', ['-c', singleTestCommand(template, { file })], { cwd: base, encoding: 'utf8' });
    assert.equal(printed.stdout, expected, template);
  }
  assert.deepEqual(readdirSync(base), [], 'no substitution ran');
  // Dropping a [ … ] segment can leave a quote next to {file}; the renderer reads the command it fills in.
  assert.throws(() => singleTestCommand(`printf %s {file} [-t '{name}' "x]"`, { file }), (error) => error.exitCode === 3 && /next to a quote/.test(error.message));
});

test('pack data for the other areas: test runner, guards, settings, scope scripts, complexity', (t) => {
  const root = tempBase(t);
  write(root, {
    '.claude/dev-workflow/packs/db/pack.json': {
      id: 'db', version: '0.1.0', title: 'DB',
      options: { migrations: { type: 'string', default: 'db/migrations', description: 'd' } },
      guards: { commands: ['psql {options.migrations}'], ports: [5432] },
      complexity: { escalate: [{ paths: ['{options.migrations}/**'], min: 'l', reason: 'schema change' }, { keywords: ['migration'], min: 'm', reason: 'data' }] },
    },
  });
  const packs = resolvePacks(wsWith(root, [...MM_PACKS, 'db']));
  assert.deepEqual(testRunnerOf(packs), { pack: 'vitest', single: 'npx vitest run {file} [-t "{name}"]' });
  assert.deepEqual(scopeScripts(packs), ['node-npm:dependency-changes', 'vitest:no-focus']);
  assert.deepEqual(packGuards(packs), {
    dependencyCommands: NPM_DEPENDENCY_COMMANDS,
    commands: ['psql db/migrations'],
    ports: [5432],
  });
  assert.deepEqual(packSettings(packs), {
    allow: ['Bash(cw *)', 'Bash(git add *)', 'Bash(git commit *)'],
    ask: ['Bash(git push *)', 'Bash(git -C * push *)', 'Bash(gh pr create *)', 'Bash(glab mr create *)', ...NPM_ASK],
    deny: ['Agent(model:*)', 'Agent(effort:*)'],
  });
  assert.deepEqual(packComplexityRules(packs), [
    { paths: ['db/migrations/**'], min: 'l', reason: 'schema change', source: 'pack:db' },
    { keywords: ['migration'], min: 'm', reason: 'data', source: 'pack:db' },
  ]);
  assert.equal(testRunnerOf(resolvePacks(wsWith(root, ['node-npm']))), null);
});

// Bash rule matching as code.claude.com/docs/en/permissions documents it (read 2026-10-19): a * matches
// any text, spaces included, at the start, in the middle or at the end; a trailing " *" (or ":*") that
// is the rule's only wildcard also matches the bare command; everything else matches as written.
function bashRuleMatches(rule, command) {
  const pattern = /^Bash\((.*)\)$/s.exec(rule)?.[1];
  if (pattern === undefined) return false;
  const text = pattern.endsWith(':*') ? `${pattern.slice(0, -2)} *` : pattern;
  const escape = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split('*');
  const source = parts.length === 2 && text.endsWith(' *') ? `${escape(parts[0].slice(0, -1))}(?: .*)?` : parts.map(escape).join('.*');
  return new RegExp(`^${source}$`, 's').test(command);
}

test('the documented Bash rule semantics: the matcher reproduces the permissions page tables', () => {
  const rows = [
    ['Bash(npm run build)', ['npm run build'], ['npm run build --watch']],
    ['Bash(npm run *)', ['npm run build', 'npm run test --watch', 'npm run'], ['npm install']],
    ['Bash(git log * main)', ['git log --oneline main', 'git log -5 main', 'git log --output=<file> main'], ['git log main', 'git push origin main']],
    ['Bash(git * main)', ['git merge main', 'git push origin main', 'git -c core.fsmonitor=<script> diff main'], ['git log']],
    ['Bash(* --version)', ['node --version', "bash -c 'echo hi' --version"], ['node -v']],
    ['Bash(ls *)', ['ls -la', 'ls'], ['lsof']],
    ['Bash(ls*)', ['ls -la', 'lsof'], []],
    ['Bash(ls:*)', ['ls -la', 'ls'], ['lsof']],
    ['Bash(* --help *)', ['npm --help x'], ['npm --help']],
    ['Bash(git push *)', ['git push origin main'], ['git -C . push origin main', 'git -c push.default=current push origin main', "git 'push' origin main"]],
  ];
  for (const [rule, matches, misses] of rows) {
    for (const command of matches) assert.equal(bashRuleMatches(rule, command), true, `${rule} should match ${command}`);
    for (const command of misses) assert.equal(bashRuleMatches(rule, command), false, `${rule} should not match ${command}`);
  }
});

test('node-npm: every npm alias that installs or removes packages asks; npm run and npm test do not', () => {
  const installs = ['npm add lodash', 'npm in x', 'npm isntall x', 'npm clean-install', 'npm ic', 'npm rm x', 'npm r x', 'npm un x', 'npm remove x', 'npm unlink x', 'npm it', 'npm cit', 'npm sit', 'npm install-ci-test', 'npm ci', 'npm i -D x'];
  for (const command of installs) assert.ok(NPM_ASK.some((rule) => bashRuleMatches(rule, command)), `no ask rule matches ${command}`);
  for (const command of ['npm run build', 'npm run rm-dist', 'npm test', 'npm init', 'npm run ci', 'npm install-script']) {
    assert.ok(!NPM_ASK.some((rule) => bashRuleMatches(rule, command)), `an ask rule matches ${command}`);
  }
});

test('the core ask rules cover every command cw pr command prints, so pushing and creating always prompt', (t) => {
  const { ask } = packSettings(resolvePacks(wsWith(tempBase(t), [])));
  const branch = 'NO-TICKET/feature/ask-rules';
  const commands = [
    // In-place git -C <appRoot> from the project root; worktree mode git -C <the worktree>.
    ...['git -C app', "git -C 'my app'", 'git -C /work/.claude/worktrees/agent-1', "git -C '/work/my app'"].map((git) => pushCommand({ git, branch })),
    adapterFor('github').createCommand({ host: { hostname: 'github.com', repo: 'acme/app' }, base: 'main', branch, title: "[FEATURE] Add it's", bodyFile: '/x/pr-body.md' }),
    adapterFor('gitlab').createCommand({ host: { webUrl: 'https://gitlab.example.com/a/b' }, base: 'main', branch, title: '[BUGFIX] Fix it', bodyFile: '/x/pr body.md' }),
  ];
  assert.equal(bashRuleMatches('Bash(git push *)', commands[0]), false, 'the printed push uses git -C, which Bash(git push *) does not match');
  for (const command of commands) assert.ok(ask.some((rule) => bashRuleMatches(rule, command)), `no ask rule matches ${command}`);
});

test('packScript resolves references and names the fix for bad ones', (t) => {
  const packs = resolvePacks(wsWith(tempBase(t)));
  const script = packScript(packs, 'vitest:no-focus');
  assert.equal(script.path, join(pluginRoot, 'packs', 'vitest', 'scripts', 'no-focus.mjs'));
  const failure = (reference) => {
    try {
      packScript(packs, reference);
    } catch (error) {
      return error;
    }
    return assert.fail(`${reference} did not throw`);
  };
  const bare = failure('vitest');
  assert.equal(bare.exitCode, 2);
  assert.match(bare.fix, /<pack>:<script>/);
  const inactive = failure('docker:image-pins');
  assert.equal(inactive.exitCode, 2);
  assert.match(inactive.fix, /core, node-npm, typescript, express, react-vite, vitest/);
  const unknown = failure('vitest:nope');
  assert.equal(unknown.exitCode, 2);
  assert.match(unknown.fix, /vitest:no-focus/);
});

test('runPackScript runs in the given work tree with the CW_ environment and a timeout', (t) => {
  const root = tempBase(t);
  write(root, {
    '.claude/dev-workflow/packs/probe/pack.json': { id: 'probe', version: '0.1.0', title: 'P', options: { level: { type: 'number', default: 2, description: 'd' } }, scripts: { env: 'scripts/env.mjs', sleep: 'scripts/sleep.mjs' } },
    '.claude/dev-workflow/packs/probe/scripts/env.mjs':
      "const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('CW_')));\nconsole.log(JSON.stringify({ cwd: process.cwd(), env, args: process.argv.slice(2) }));\nprocess.exitCode = 7;\n",
    '.claude/dev-workflow/packs/probe/scripts/sleep.mjs': 'setTimeout(() => {}, 10_000);\n',
    'work/.keep': '',
  });
  const packs = resolvePacks(wsWith(root, ['probe']));
  const workTree = join(root, 'work');
  const result = runPackScript(packs, 'probe:env', { workTree, configRoot: root, base: 'abc', defaultBase: 'main', packageDirs: ['.', 'api'], args: ['--x', 'y'] });
  assert.equal(result.code, 7);
  assert.equal(result.timedOut, false);
  const seen = JSON.parse(result.stdout);
  assert.equal(seen.cwd.endsWith('/work'), true);
  assert.deepEqual(seen.args, ['--x', 'y']);
  assert.deepEqual(seen.env, {
    CW_WORK_TREE: workTree, CW_CONFIG_ROOT: root, CW_PACK_OPTIONS: '{"level":2}', CW_TASK: '', CW_TASK_DIR: '', CW_BASE: 'abc', CW_DEFAULT_BASE: 'main', CW_PACKAGE_DIRS: '[".","api"]',
  });
  const slow = runPackScript(packs, 'probe:sleep', { workTree, configRoot: root, timeoutMs: 300 });
  assert.equal(slow.timedOut, true);
  assert.equal(slow.code, 124);
});

test('detectPacks finds packs and variants from dependencies and files', (t) => {
  const root = tempBase(t);
  write(root, {
    'package.json': { name: 'mono', workspaces: ['web', 'api'], devDependencies: { vitest: '^3.2.0' } },
    'web/package.json': { dependencies: { react: '^19.0.0' } },
    'api/package.json': { dependencies: { express: '^5.1.0' } },
    'tsconfig.json': '{}\n',
  });
  const found = detectPacks(root, { files: ['package.json', 'web/package.json', 'api/package.json', 'tsconfig.json'], packageDirs: ['web', 'api'] });
  assert.deepEqual(found, [
    { id: 'express', variant: '5', defaultVariant: '5', areas: ['backend'] },
    { id: 'node-npm', variant: null, defaultVariant: null, areas: ['backend', 'frontend'] },
    { id: 'react-vite', variant: 'react-19', defaultVariant: 'react-19', areas: ['frontend'] },
    { id: 'typescript', variant: null, defaultVariant: null, areas: [] },
    { id: 'vitest', variant: null, defaultVariant: null, areas: [] },
  ]);
  write(root, { 'api/package.json': { dependencies: { express: '~4.21.0' } }, 'web/package.json': { dependencies: { react: '18.3.1' } } });
  const older = detectPacks(root, { files: ['package.json'], packageDirs: ['web', 'api'] });
  assert.equal(older.find((pack) => pack.id === 'express').variant, '4');
  assert.equal(older.find((pack) => pack.id === 'react-vite').variant, 'react-18');
  write(root, { 'web/package.json': { dependencies: { react: '^17.0.2' } } });
  assert.deepEqual(detectPacks(root, { files: ['package.json'], packageDirs: ['web', 'api'] }).find((pack) => pack.id === 'react-vite'), { id: 'react-vite', variant: null, defaultVariant: 'react-19', areas: ['frontend'] });
});
