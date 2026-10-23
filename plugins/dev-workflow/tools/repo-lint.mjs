// Repository checks for the remklov marketplace: skill budgets, private terms, manifests and
// plugin agents. Every problem names the file and what to change.
//   node plugins/dev-workflow/tools/repo-lint.mjs              lint the repository this file lives in
//   node plugins/dev-workflow/tools/repo-lint.mjs --root DIR   lint the git checkout at DIR
//   … --range A..B                                            also check the commits in A..B (messages,
//                                                             author and committer) against the private list
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = 'plugins/dev-workflow/tools/repo-lint.mjs';

// Names of the removed predecessor plugins; only the mod's MIT attribution may name them.
export const PRIVATE_TERMS = ['savvy'];
// The build plan names the terms it bans, and this file defines them.
const TERM_EXEMPT_FILES = new Set(['docs/PLAN.md', SELF]);
// The private list (names that must never reach this repository) lives outside it: the FORBIDDEN_TERMS
// variable (a CI secret) or this file, one term per line. It applies to every file, path and commit.
export const TERMS_FILE = join(homedir(), '.config', 'claude-tools', 'forbidden-terms');

export function externalTerms(env = process.env, file = TERMS_FILE) {
  const source = env.FORBIDDEN_TERMS ?? (existsSync(file) ? readFileSync(file, 'utf8') : null);
  if (source === null) return null;
  return source.split('\n').map((line) => line.trim().toLowerCase()).filter((line) => line && !line.startsWith('#'));
}

// The list is private, so a report shows a term's length, not the term.
const masked = (term) => '*'.repeat(term.length);
// The MIT license of the adapted savvy-progress parts requires naming them in the mod's notices.
const ATTRIBUTION = { prefix: 'plugins/agents-progress/', text: /savvy-progress/gi };

const BUDGETS = [
  { pattern: /^plugins\/[^/]+\/skills\/[^/]+\/SKILL\.md$/, max: 200 },
  { pattern: /^plugins\/[^/]+\/skills\/[^/]+\/steps\/.+\.md$/, max: 80 },
  { pattern: /^plugins\/[^/]+\/skills\/[^/]+\/reference\/.+\.md$/, max: 150 },
];

// Fields Claude Code ignores for plugin agents (documented), and isolation, which cw prints per call (D4).
const FORBIDDEN_AGENT_FIELDS = ['permissionMode', 'hooks', 'mcpServers', 'initialPrompt', 'isolation'];

const MANIFESTS = /^(\.claude-plugin\/marketplace\.json|plugins\/[^/]+\/\.claude-plugin\/plugin\.json)$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function readText(root, file) {
  try {
    return readFileSync(join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
}

function readJson(root, file, problems) {
  const text = readText(root, file);
  if (text === null) {
    problems.push(`${file}: missing`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    problems.push(`${file}: invalid JSON (${error.message})`);
    return null;
  }
}

function checkBudgets(root, files, problems) {
  for (const file of files) {
    const budget = BUDGETS.find(({ pattern }) => pattern.test(file));
    if (!budget) continue;
    const text = readText(root, file) ?? '';
    const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    if (lines > budget.max) problems.push(`${file}: ${lines} lines, the budget is ${budget.max}; move detail into a reference file`);
  }
}

function checkPrivateTerms(root, files, problems, terms) {
  const find = (list, text) => list.find((term) => text.toLowerCase().includes(term));
  for (const file of files) {
    const inPath = find(PRIVATE_TERMS, file);
    if (inPath) problems.push(`${file}: the path contains the private term "${inPath}"; rename it`);
    const inPathPrivate = find(terms, file);
    if (inPathPrivate) problems.push(`${file.replace(new RegExp(inPathPrivate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), masked)}: the path contains a term of the private list; rename it`);
    const text = readText(root, file);
    if (text === null) continue;
    text.split('\n').forEach((line, index) => {
      const privateTerm = find(terms, line);
      if (privateTerm) problems.push(`${file}:${index + 1}: a term of the private list ("${masked(privateTerm)}"); remove it`);
      if (TERM_EXEMPT_FILES.has(file)) return;
      const checked = file.startsWith(ATTRIBUTION.prefix) ? line.replace(ATTRIBUTION.text, '') : line;
      const term = find(PRIVATE_TERMS, checked);
      if (term) problems.push(`${file}:${index + 1}: private term "${term}"; remove it`);
    });
  }
}

// Commit messages, author and committer of the commits in range; history is published with the branch.
function checkCommits(root, range, problems, terms) {
  let log = '';
  try {
    log = execFileSync('git', ['log', '-z', '--format=%h%n%an <%ae>%n%cn <%ce>%n%B', range], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    problems.push(`git log ${range} failed: ${String(error.stderr ?? error.message).trim()}`);
    return;
  }
  for (const entry of log.split('\0').filter(Boolean)) {
    const [sha, author, committer, ...message] = entry.split('\n');
    const hit = (text) => terms.find((term) => text.toLowerCase().includes(term));
    if (hit(author) || hit(committer)) problems.push(`commit ${sha}: the author or committer contains a term of the private list; rewrite it (git commit --amend --reset-author, or git rebase)`);
    if (hit(message.join('\n'))) problems.push(`commit ${sha}: the message contains a term of the private list; reword it`);
  }
}

// The manifests are parsed by checkManifests.
function checkJson(root, files, problems) {
  for (const file of files.filter((name) => name.endsWith('.json') && !MANIFESTS.test(name))) readJson(root, file, problems);
}

function checkManifests(root, problems) {
  const marketplace = readJson(root, '.claude-plugin/marketplace.json', problems);
  if (!marketplace) return;
  const listed = new Set();
  for (const entry of marketplace.plugins ?? []) {
    const where = `.claude-plugin/marketplace.json plugin "${entry.name}"`;
    const source = String(entry.source ?? '').replace(/\/+$/, '');
    if (!/^\.\/plugins\/[^/]+$/.test(source)) {
      problems.push(`${where}: source must be "./plugins/<name>"`);
      continue;
    }
    const dir = source.slice(2);
    listed.add(dir);
    if ('version' in entry) problems.push(`${where}: remove "version"; the version lives in the plugin's plugin.json`);
    if ('dependencies' in entry) problems.push(`${where}: remove "dependencies"; a dependency installs the other plugin automatically (D1)`);
    const manifest = readJson(root, `${dir}/.claude-plugin/plugin.json`, problems);
    if (!manifest) continue;
    if (manifest.name !== entry.name) problems.push(`${dir}/.claude-plugin/plugin.json: name "${manifest.name ?? ''}" differs from the marketplace entry "${entry.name}"`);
    if (!SEMVER.test(String(manifest.version ?? ''))) problems.push(`${dir}/.claude-plugin/plugin.json: version must be semver (x.y.z)`);
    if ('dependencies' in manifest) problems.push(`${dir}/.claude-plugin/plugin.json: remove "dependencies"; a dependency installs the other plugin automatically (D1)`);
    if (existsSync(join(root, dir, 'settings.json'))) problems.push(`${dir}/settings.json: remove it; the plugins ship no root settings (D1)`);
  }
  const pluginsDir = join(root, 'plugins');
  for (const name of existsSync(pluginsDir) ? readdirSync(pluginsDir) : []) {
    if (statSync(join(pluginsDir, name)).isDirectory() && !listed.has(`plugins/${name}`)) {
      problems.push(`plugins/${name}: not listed in .claude-plugin/marketplace.json`);
    }
  }
}

function checkAgents(root, files, problems) {
  for (const file of files.filter((name) => /^plugins\/[^/]+\/agents\/.+\.md$/.test(name))) {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(readText(root, file) ?? '')?.[1] ?? '';
    for (const field of FORBIDDEN_AGENT_FIELDS) {
      if (new RegExp(`^${field}:`, 'm').test(frontmatter)) {
        problems.push(`${file}: remove "${field}" (ignored for plugin agents, or printed by cw per call)`);
      }
    }
  }
}

export function lint(root, { terms = [], range = null } = {}) {
  let top = '';
  let real = '';
  try {
    real = realpathSync(root);
    top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // Missing, or not inside a git checkout.
  }
  if (!top || realpathSync(top) !== real) return [`${root}: not the top of a git checkout`];
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && existsSync(join(root, file)));
  const problems = [];
  checkBudgets(root, files, problems);
  checkPrivateTerms(root, files, problems, terms);
  if (range) checkCommits(root, range, problems, terms);
  checkJson(root, files, problems);
  checkManifests(root, problems);
  checkAgents(root, files, problems);
  return problems;
}

// Node resolves symlinks in the main module's URL, so compare real paths.
const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

// Sets process.exitCode instead of calling process.exit, so stderr drains before Node exits.
function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const rangeIndex = args.indexOf('--range');
  if ((rootIndex !== -1 && !args[rootIndex + 1]) || (rangeIndex !== -1 && !args[rangeIndex + 1])) {
    console.error('usage: repo-lint.mjs [--root DIR] [--range A..B]');
    process.exitCode = 2;
    return;
  }
  const root =
    rootIndex === -1
      ? execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: 'utf8' }).trim()
      : args[rootIndex + 1];
  const terms = externalTerms();
  const problems = lint(root, { terms: terms ?? [], range: rangeIndex === -1 ? null : args[rangeIndex + 1] });
  if (terms === null) {
    const message = `no private-terms list (FORBIDDEN_TERMS or ${TERMS_FILE})`;
    if (process.env.CI) problems.push(message);
    else console.warn(`warning: ${message}; the private terms were not checked`);
  }
  if (problems.length) {
    console.error(problems.map((problem) => `- ${problem}`).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('repo-lint: ok');
}

if (isMain()) main();
