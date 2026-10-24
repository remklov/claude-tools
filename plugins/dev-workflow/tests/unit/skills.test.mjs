// The role skills (docs/PLAN.md §6, D2, D4): frontmatter rules, budgets, file references, and every
// cw command line in them against the cw registry and through cw itself, so a skill never tells an agent
// to run a command, a flag or a flag combination that cw refuses.
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import { main, registry } from '../../cli/cw.mjs';
import { ROLES } from '../../cli/commands/playbook.mjs';
import { parseArgs } from '../../cli/lib/args.mjs';
import { parseFrontmatter } from '../../cli/lib/frontmatter.mjs';
import { readJson, writeJson } from '../../cli/lib/fsx.mjs';
import { validateDevReportInput, validateReviewInput } from '../../cli/lib/report.mjs';
import { loadSchema, validateWith } from '../../cli/lib/schema.mjs';
import { cw, gitIn, inPlaceConfig, makeInPlace, pluginRoot } from '../fixtures/repo.mjs';
import { minimalPath } from '../fixtures/stubs.mjs';

const SKILLS = join(pluginRoot, 'skills');

// The frontmatter fields of code.claude.com/docs/en/skills (read 2026-10-20). Claude Code ignores an
// unknown field without an error, so a typo would silently drop a setting.
const DOCUMENTED_FIELDS = new Set([
  'name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable',
  'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent', 'hooks', 'paths', 'background', 'shell',
  'metadata', 'license', 'compatibility',
]);
// The skill listing truncates description plus when_to_use at this length (same page).
const DESCRIPTION_MAX = 1536;

// D2: the entry is user-only. D4/S1: the agent playbooks are hidden from the / menu and never carry
// disable-model-invocation, which would stop the preload. status and doctor are for the user.
const EXPECTED = {
  ticket: { 'disable-model-invocation': true },
  'implementer-playbook': { 'user-invocable': false },
  'reviewer-playbook': { 'user-invocable': false },
  status: {},
  doctor: {},
};

const BUDGETS = [
  { pattern: /^[^/]+\/SKILL\.md$/, max: 200 },
  { pattern: /^[^/]+\/steps\/.+\.md$/, max: 80 },
  { pattern: /^[^/]+\/reference\/.+\.md$/, max: 150 },
];

const ROLE_OF = { ticket: 'orchestrator', 'implementer-playbook': 'implementer', 'reviewer-playbook': 'reviewer' };

// For each role skill: the commands it must name, each with the flags its cw lines must use at least
// once (§6 and the playbook package of P3).
const REQUIRED = {
  ticket: {
    doctor: ['quick'],
    'task list': ['ticket'],
    'task new': ['ticket', 'slug', 'title', 'type', 'rebind'],
    'ticket context': ['ticket'],
    'ticket save': ['task'],
    'spec save': ['task'],
    'spec show': ['task'],
    'spec lint': ['task'],
    classify: ['task', 'paths', 'set', 'why', 'override'],
    'task confirm': ['task', 'note'],
    'task start': ['task', 'new-agent'],
    'task agent': ['task', 'role', 'id'],
    'report show': ['task'],
    'task reset': ['task', 'keep', 'note'],
    'git foreign-commits': ['task'],
    'task review': ['task', 'new-agent'],
    'review show': ['task'],
    'task return': ['task', 'spec-changed', 'continue', 'note', 'new-agent'],
    'pr title': ['task'],
    'pr body': ['task', 'stdin'],
    'pr command': ['task'],
    'pr record': ['task', 'url', 'skipped'],
    'task cleanup': ['task'],
    'task end': ['task', 'outcome'],
    'task show': ['task'],
    'playbook show': ['task'],
    'playbook read': [],
  },
  'implementer-playbook': {
    'ws setup': ['task'],
    context: ['task'],
    // ADR 0013: the change is checked against every applicable rule before the checks (step 4).
    'rules applicable': ['task'],
    checks: ['task', 'changed'],
    // PB-1: the body on stdin and attribution lines as trailers, so the agent writes nothing under .git.
    'commit msg': ['task', 'summary', 'keyword', 'body-file', 'trailer'],
    'commit lint': ['task'],
    prove: ['task', 'test', 'change'],
    'report save': ['task'],
    step: ['task', 'done', 'note'],
    run: ['task'],
    'rules show': [],
  },
  'reviewer-playbook': {
    'review scope': ['task'],
    checks: ['task', 'changed'],
    prove: ['task', 'recheck'],
    'rules applicable': ['task'],
    'commit lint': ['task'],
    'review save': ['task'],
    run: ['task'],
  },
};

function filesBelow(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

const skillNames = () => readdirSync(SKILLS).filter((name) => statSync(join(SKILLS, name)).isDirectory()).sort();
const skillFiles = (skill) => filesBelow(join(SKILLS, skill)).filter((file) => file.endsWith('.md'));
const read = (file) => readFileSync(file, 'utf8');
const frontmatter = (skill) => parseFrontmatter(read(join(SKILLS, skill, 'SKILL.md')), `${skill}/SKILL.md`).data;

// The contents of inline code spans and the lines of fenced code blocks.
function codeSnippets(text) {
  const snippets = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? null : marker;
      continue;
    }
    if (fence) snippets.push(line.trim());
    else for (const match of line.matchAll(/`([^`]+)`/g)) snippets.push(match[1].trim());
  }
  return snippets;
}

// A word that starts with a shell operator, a heredoc or a redirection ends the command.
const OPERATOR = /^(<<|<\s|2?>|\||&&|;)/;

// Shell-like words with the quotes removed, up to the first operator outside quotes.
function words(command) {
  const result = [];
  let current = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (!started && OPERATOR.test(command.slice(i))) {
      break;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) result.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) result.push(current);
  return result;
}

// The registered command whose path is the longest prefix of the leading words (as cw.mjs finds it).
function findCommand(argv) {
  const leading = [];
  for (const token of argv) {
    if (token.startsWith('-')) break;
    leading.push(token);
  }
  let best = null;
  for (const command of registry) {
    if (command.path.every((part, i) => leading[i] === part) && (!best || command.path.length > best.path.length)) best = command;
  }
  return best;
}

// Every cw command line of a skill: { file, line, path, flags } or { file, line, problem }.
function cwLines(skill) {
  const lines = [];
  for (const file of skillFiles(skill)) {
    const where = relative(SKILLS, file);
    for (const snippet of codeSnippets(read(file))) {
      if (!/^cw\s/.test(snippet)) continue;
      const argv = words(snippet).slice(1);
      if (argv[0] === 'help') {
        const target = argv.length > 1 ? findCommand(argv.slice(1)) : true;
        lines.push(target ? { file: where, line: snippet, path: 'help', flags: [] } : { file: where, line: snippet, problem: 'cw help names no command' });
        continue;
      }
      const command = findCommand(argv);
      if (!command) {
        lines.push({ file: where, line: snippet, problem: 'no registered command' });
        continue;
      }
      const parsed = parseArgs(argv.slice(command.path.length), command.flags);
      const problems = [...parsed.unknown.map((flag) => `unknown option ${flag}`), ...parsed.errors];
      if (parsed.positionals.length && !command.positionals) problems.push(`unexpected argument ${parsed.positionals[0]}`);
      lines.push(problems.length
        ? { file: where, line: snippet, problem: problems.join('; ') }
        : { file: where, line: snippet, argv, path: command.path.join(' '), flags: Object.keys(parsed.flags) });
    }
  }
  return lines;
}

test('the skills are exactly the role and user skills of §13', () => {
  assert.deepEqual(skillNames(), Object.keys(EXPECTED).sort());
});

test('frontmatter: documented fields, name, description, and the invocation rules of D2 and D4', () => {
  for (const skill of skillNames()) {
    const data = frontmatter(skill);
    for (const key of Object.keys(data)) assert.ok(DOCUMENTED_FIELDS.has(key), `${skill}: "${key}" is not a documented skill field`);
    assert.equal(data.name, skill, `${skill}: name must equal the directory name`);
    assert.equal(typeof data.description, 'string', `${skill}: description is required`);
    assert.ok(data.description.trim().length > 0, `${skill}: description is empty`);
    const listed = `${data.description}${data.when_to_use ? ` ${data.when_to_use}` : ''}`;
    assert.ok(listed.length <= DESCRIPTION_MAX, `${skill}: description is ${listed.length} characters; the listing truncates at ${DESCRIPTION_MAX}`);
    for (const [key, value] of Object.entries(EXPECTED[skill])) assert.equal(data[key], value, `${skill}: ${key} must be ${value}`);
  }
  assert.notEqual(frontmatter('ticket')['user-invocable'], false, 'ticket is the user entry (D2)');
  for (const skill of ['implementer-playbook', 'reviewer-playbook']) {
    assert.ok(!('disable-model-invocation' in frontmatter(skill)), `${skill}: never set disable-model-invocation; it stops the preload (S1)`);
  }
  for (const skill of ['status', 'doctor']) {
    const data = frontmatter(skill);
    assert.notEqual(data['user-invocable'], false, `${skill} is for the user`);
    assert.notEqual(data['disable-model-invocation'], true, `${skill}: keep it available to Claude too`);
  }
});

test('every skill an agent preloads exists and can be preloaded', () => {
  const agents = join(pluginRoot, 'agents');
  const preloaded = [];
  for (const file of readdirSync(agents).filter((name) => name.endsWith('.md'))) {
    const { data } = parseFrontmatter(read(join(agents, file)), file);
    for (const entry of data.skills ?? []) {
      const name = String(entry).replace(/^dev-workflow:/, '');
      assert.ok(existsSync(join(SKILLS, name, 'SKILL.md')), `${file} preloads ${entry}, which does not exist`);
      assert.notEqual(frontmatter(name)['disable-model-invocation'], true, `${file} preloads ${entry}, which disables model invocation (S1)`);
      preloaded.push(name);
    }
  }
  assert.deepEqual([...new Set(preloaded)].sort(), ['implementer-playbook', 'reviewer-playbook']);
});

test('skill files keep their line budgets', () => {
  for (const skill of skillNames()) {
    for (const file of skillFiles(skill)) {
      const where = relative(SKILLS, file);
      const budget = BUDGETS.find(({ pattern }) => pattern.test(where));
      assert.ok(budget, `${where}: skill files are SKILL.md, steps/*.md or reference/*.md`);
      const text = read(file);
      const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
      assert.ok(lines <= budget.max, `${where}: ${lines} lines, the budget is ${budget.max}`);
    }
  }
});

test('every referenced skill file exists, and every step and reference file is referenced', () => {
  for (const skill of skillNames()) {
    const dir = join(SKILLS, skill);
    const files = skillFiles(skill);
    const referenced = new Set();
    for (const file of files) {
      for (const match of read(file).matchAll(/(?:\$\{CLAUDE_SKILL_DIR\}\/|cw playbook read )([\w./-]+)/g)) {
        const target = match[1].replace(/[.)]+$/, '');
        assert.ok(existsSync(join(dir, target)), `${relative(SKILLS, file)} names ${target}, which is not in ${skill}/`);
        if (join(dir, target) !== file) referenced.add(target);
      }
      for (const match of read(file).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
        const target = match[1].replace(/[.)]+$/, '');
        assert.ok(existsSync(join(pluginRoot, target)), `${relative(SKILLS, file)} names ${target}, which is not in the plugin`);
      }
    }
    for (const file of files.map((path) => relative(dir, path)).filter((path) => path !== 'SKILL.md')) {
      assert.ok(referenced.has(file), `${skill}/${file} is referenced by no other file of the skill`);
    }
  }
});

test('every cw command line in the skills names a registered command with flags it accepts', () => {
  const lines = skillNames().flatMap(cwLines);
  assert.ok(lines.length >= 60, `only ${lines.length} cw command lines found; the extraction is broken`);
  assert.deepEqual(lines.filter((line) => line.problem).map((line) => `${line.file}: \`${line.line}\`: ${line.problem}`), []);
});

// The run-through below (PB-4): every cw line of the skills goes through cw's own main() against a real
// task, and must not end in a usage error (exit 2). cw itself is the reference for required flags and
// refused combinations, so this test cannot drift from cw the way a copied list of flag rules would.
//
// The values for the placeholder words of those lines (as words() leaves them), chosen so that a correct
// line passes cw's usage checks in the fixture: an existing package, test file, source file, pack script
// and rule. '<id>' becomes the fixture task. A word with a placeholder that is not listed fails the test,
// so every new placeholder gets a deliberate value.
const PLACEHOLDERS = {
  '<KEY>': 'NO-TICKET',
  '<slug>': 'other-change',
  '<title>': 'Change sum',
  '<c>': 's',
  '<agentId>': 'agent-1',
  '<implementer|reviewer>': 'implementer',
  '<url>': 'https://github.com/acme/app/pull/1',
  '<reason>': 'No remote.',
  '<why>': 'The user stopped it.',
  '<n>': '3',
  '<ID>': 'CORE-SCOPE',
  '<branch>': 'main',
  '<package>': 'app',
  '<file>': 'src/sum.mjs',
  '<file>,<file>': 'src/sum.mjs',
  '<package>:<file>::<test name>': 'app:src/sum.test.mjs::adds',
  '<pack>:<script>': 'vitest:no-focus',
  '<commit>': 'HEAD',
  '<commit>:<file>': 'HEAD:src/sum.mjs',
};
const PLACEHOLDER = /<[^<>\s]+>/;

// The phases a line is tried in. cw checks most flag rules before the phase precondition, but some only
// after it (task return --spec-changed and --continue need --note only in deliver and escalated), so a
// line that meets a precondition (exit 3) or a gap of these made-up states (exit 4) is tried in the next
// phase. Every run starts from the same task state, with a base so that cw run can pass --base.
const PHASES = [
  { phase: 'spec' },
  { phase: 'implement', round: 1 },
  { phase: 'review', round: 1, reviewRound: 1 },
  { phase: 'deliver', round: 1, specChanged: true },
  { phase: 'escalated', round: 1, reviewRound: 3 },
];

function captureIo(cwd, env) {
  const stderr = { text: '', write: (chunk) => (stderr.text += chunk) };
  // Every command that reads stdin gets a body: an empty one is a usage error of its own.
  return { cwd, env, stdin: () => '{}\n', stdout: { write: () => {} }, stderr, isTTY: false };
}

test('every cw command line in the skills passes cw\'s own usage checks against a real task (no exit 2)', async (t) => {
  const packages = [{ id: 'app', path: '.', areas: ['backend'], checks: { test: 'node --test' }, testSingle: 'node --test [--test-name-pattern {name}] {file}' }];
  const fx = makeInPlace(t, { config: inPlaceConfig({ packs: ['vitest'], packages }) });
  // In-process cw runs git with process.env: keep it away from the developer's git config.
  for (const [key, value] of Object.entries(fx.env)) if (key.startsWith('GIT_')) process.env[key] = value;
  const created = cw(fx.root, ['task', 'new', '--ticket', 'NO-TICKET', '--slug', 'sum-change', '--title', 'Change sum', '--type', 'feature', '--json'], { env: fx.env });
  assert.equal(created.code, 0, created.stderr);
  const id = created.json().task;
  const base = { branch: 'main', commit: gitIn(fx.app, fx.env)('rev-parse', 'HEAD') };
  const state = join(fx.root, '.git', 'dev-workflow');
  const snapshot = join(fx.base, 'state-snapshot');
  cpSync(state, snapshot, { recursive: true });
  const taskFile = join(state, 'tasks', id, 'task.json');
  // As in a session: CLAUDECODE=1 (cw init refuses to write there), and no real claude, gh or glab.
  const env = { ...fx.env, CLAUDECODE: '1', PATH: minimalPath(fx.base) };
  const values = { ...PLACEHOLDERS, '<id>': id };

  // A snippet with the command name alone (`cw context`) is a mention in the text, not a line to run.
  const lines = skillNames().flatMap(cwLines).filter((line) => !line.problem && line.path !== 'help' && line.argv.length > line.path.split(' ').length);
  const problems = [];
  for (const line of lines) {
    const argv = line.argv.map((word) => values[word] ?? word);
    const unknown = argv.find((word) => PLACEHOLDER.test(word));
    if (unknown) {
      problems.push(`${line.file}: \`${line.line}\`: no value for the placeholder word ${unknown}`);
      continue;
    }
    let result;
    for (const patch of PHASES) {
      rmSync(state, { recursive: true, force: true });
      cpSync(snapshot, state, { recursive: true });
      writeJson(taskFile, { ...readJson(taskFile), base, ...patch });
      const io = captureIo(fx.root, env);
      result = { code: await main(argv, io), message: io.stderr.text.trim().split('\n').join(' / ') };
      if (result.code !== 3 && result.code !== 4) break;
    }
    if (result.code === 2) problems.push(`${line.file}: \`${line.line}\`: ${result.message}`);
  }
  assert.ok(lines.length >= 50, `only ${lines.length} cw command lines to run; the extraction is broken`);
  assert.deepEqual(problems, []);
});

test('each role skill names the commands of its role with the flags the playbook uses', () => {
  for (const [skill, required] of Object.entries(REQUIRED)) {
    const role = ROLE_OF[skill];
    for (const path of ROLES[role].commands) assert.ok(path in required, `${skill}: REQUIRED misses ${path}, a command of cw playbook show ${role}`);
    const used = new Map();
    for (const line of cwLines(skill).filter((entry) => !entry.problem)) {
      used.set(line.path, new Set([...(used.get(line.path) ?? []), ...line.flags]));
    }
    for (const [path, flags] of Object.entries(required)) {
      assert.ok(used.has(path), `${skill}: no \`cw ${path} …\` line`);
      for (const flag of flags) assert.ok(used.get(path).has(flag), `${skill}: no \`cw ${path}\` line with --${flag}`);
    }
  }
});

// The JSON example written to the scratchpad before the first `<command> --task <id> < <file>` line.
function heredoc(text, command) {
  const at = text.indexOf(`${command} --task <id> < `);
  assert.ok(at >= 0, `no ${command} line that reads a file on stdin`);
  const fences = [...text.slice(0, at).matchAll(/```json\n([\s\S]*?)\n```/g)];
  assert.ok(fences.length, `no JSON example before ${command}`);
  return JSON.parse(fences.at(-1)[1]);
}

test('the report and review examples are valid, and the playbooks name every field of their schema', () => {
  const implementer = read(join(SKILLS, 'implementer-playbook', 'SKILL.md'));
  const reviewer = read(join(SKILLS, 'reviewer-playbook', 'SKILL.md'));
  assert.deepEqual(validateDevReportInput(heredoc(implementer, 'cw report save')), []);
  assert.deepEqual(validateReviewInput(heredoc(reviewer, 'cw review save')), []);

  const report = loadSchema('dev-report');
  for (const name of [...Object.keys(report.properties), ...report.properties.status.enum]) {
    assert.ok(implementer.includes(`\`${name}\``), `implementer-playbook does not name ${name}`);
  }
  const review = loadSchema('review');
  const finding = review.properties.findings.items;
  for (const name of [...Object.keys(review.properties), ...review.properties.status.enum, ...Object.keys(finding.properties), ...finding.properties.severity.enum]) {
    assert.ok(reviewer.includes(`\`${name}\``), `reviewer-playbook does not name ${name}`);
  }
});

test('the ticket snapshot example of O3 is a valid snapshot', () => {
  const text = read(join(SKILLS, 'ticket', 'steps', 'o3-spec.md'));
  assert.deepEqual(validateWith('ticket', heredoc(text, 'cw ticket save')), []);
});

test('the orchestrator skill keeps the delegation ground rules (D4)', () => {
  const text = read(join(SKILLS, 'ticket', 'SKILL.md'));
  for (const phrase of ['run_in_background: false', 'isolation', 'SendMessage', 'cw report show', 'cw review show', 'AskUserQuestion', 'Never `cd`', 'G-ORCH-EDIT', 'G-AGENT-PARAMS']) {
    assert.ok(text.includes(phrase), `ticket/SKILL.md lost "${phrase}"`);
  }
  assert.ok(text.includes('$ARGUMENTS'), 'ticket/SKILL.md must receive the command arguments');
  // Main-session Agent calls without run_in_background ran in the background (Appendix A): Explore too.
  assert.match(read(join(SKILLS, 'ticket', 'steps', 'o1-intake.md')), /"Explore"[^\n]*run_in_background: false/);
});
