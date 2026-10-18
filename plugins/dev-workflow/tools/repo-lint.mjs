// Repository checks for claude-tools (spec 08 §2):
//   node tools/repo-lint.mjs                 budgets, no Fable models, schemas, secret patterns
//   node tools/repo-lint.mjs --terms [--range <a..b>]   forbidden terms (list from FORBIDDEN_TERMS or
//                                            ~/.config/claude-tools/forbidden-terms) in files, paths and commit messages
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWith } from '../scripts/lib/schema.mjs';

const pluginRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: pluginRoot, encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
const problems = [];
const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter(Boolean).filter((file) => existsSync(join(repoRoot, file)));

function termsCheck() {
  const fromEnv = process.env.FORBIDDEN_TERMS;
  const file = join(homedir(), '.config', 'claude-tools', 'forbidden-terms');
  const source = fromEnv ?? (existsSync(file) ? readFileSync(file, 'utf8') : null);
  if (!source) {
    const message = 'no forbidden-terms list (FORBIDDEN_TERMS or ~/.config/claude-tools/forbidden-terms)';
    if (process.env.CI) problems.push(message);
    else console.warn(`warning: ${message}`);
    return;
  }
  const terms = source.split('\n').map((line) => line.trim().toLowerCase()).filter(Boolean);
  const mask = (text) => text.replace(/./g, '*');
  const hit = (text) => terms.find((term) => text.toLowerCase().includes(term));
  for (const file of tracked) {
    const inPath = hit(file);
    if (inPath) problems.push(`forbidden term in path ${file.replace(new RegExp(inPath, 'i'), mask(inPath))}`);
    let text;
    try {
      text = readFileSync(join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, i) => {
      const term = hit(line);
      if (term) problems.push(`forbidden term in ${file}:${i + 1} (${mask(term)})`);
    });
  }
  const rangeIndex = args.indexOf('--range');
  const range = rangeIndex === -1 ? null : args[rangeIndex + 1];
  if (range) {
    let log = '';
    try {
      log = execFileSync('git', ['log', '--format=%H%n%B%n--end--', range], { cwd: repoRoot, encoding: 'utf8' });
    } catch {
      log = execFileSync('git', ['log', '--format=%H%n%B%n--end--', '-50'], { cwd: repoRoot, encoding: 'utf8' });
    }
    for (const entry of log.split('--end--')) {
      const [sha, ...body] = entry.trim().split('\n');
      const term = hit(body.join('\n'));
      if (sha && term) problems.push(`forbidden term in the message of commit ${sha.slice(0, 10)}`);
    }
    for (const ref of execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/tags'], { cwd: repoRoot, encoding: 'utf8' }).split('\n')) {
      if (ref && hit(ref)) problems.push('forbidden term in a branch or tag name');
    }
  }
}

function lineCount(path) {
  return readFileSync(path, 'utf8').split('\n').length;
}

function budgets() {
  const skills = join(pluginRoot, 'skills');
  for (const skill of readdirSync(skills)) {
    const dir = join(skills, skill);
    if (existsSync(join(dir, 'SKILL.md')) && lineCount(join(dir, 'SKILL.md')) > 200) problems.push(`${skill}/SKILL.md over 200 lines`);
    for (const [sub, max] of [['steps', 80], ['reference', 150]]) {
      if (!existsSync(join(dir, sub))) continue;
      for (const file of readdirSync(join(dir, sub))) if (lineCount(join(dir, sub, file)) > max) problems.push(`${skill}/${sub}/${file} over ${max} lines`);
    }
  }
  for (const pack of readdirSync(join(pluginRoot, 'packs'))) {
    const playbooks = join(pluginRoot, 'packs', pack, 'playbooks');
    if (!existsSync(playbooks)) continue;
    for (const role of readdirSync(playbooks)) for (const file of readdirSync(join(playbooks, role))) {
      if (lineCount(join(playbooks, role, file)) > 120) problems.push(`packs/${pack}/playbooks/${role}/${file} over 120 lines`);
    }
  }
}

function noFable() {
  for (const file of tracked.filter((f) => /(^|\/)agents\/.*\.md$/.test(f) || /templates\//.test(f))) {
    if (/^model:\s*\S*fable/im.test(readFileSync(join(repoRoot, file), 'utf8'))) problems.push(`${file} uses a Fable model`);
  }
  for (const file of tracked.filter((f) => /\.claude-plugin\/plugin\.json$|agents\/.*\.md$/.test(f))) {
    const text = readFileSync(join(repoRoot, file), 'utf8');
    for (const field of ['permissionMode:', 'initialPrompt:', 'mcpServers:', 'hooks:']) {
      if (/agents\/.*\.md$/.test(file) && new RegExp(`^${field}`, 'm').test(text)) problems.push(`${file}: ${field} is ignored for plugin agents`);
    }
  }
}

function schemas() {
  for (const pack of readdirSync(join(pluginRoot, 'packs'))) {
    const file = join(pluginRoot, 'packs', pack, 'pack.json');
    for (const error of validateWith('pack', JSON.parse(readFileSync(file, 'utf8')))) problems.push(`packs/${pack}/pack.json ${error.path}: ${error.message}`);
  }
  for (const file of tracked.filter((f) => /^examples\/.*\/profile\.json$/.test(f))) {
    for (const error of validateWith('profile', JSON.parse(readFileSync(join(repoRoot, file), 'utf8')))) problems.push(`${file} ${error.path}: ${error.message}`);
  }
}

function secrets() {
  const patterns = [/ghp_[A-Za-z0-9]{20,}/, /\bm0-[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /"password"\s*:\s*"[^"]{6,}"/i];
  for (const file of tracked) {
    if (/tests\/|spikes\//.test(file) || /\.(png|jpg|gif|ico)$/.test(file)) continue;
    let text;
    try {
      text = readFileSync(join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }
    for (const pattern of patterns) if (pattern.test(text)) problems.push(`${file} matches a secret pattern ${pattern}`);
  }
}

if (args.includes('--terms')) termsCheck();
else {
  budgets();
  noFable();
  schemas();
  secrets();
}
if (problems.length) {
  console.error(problems.map((problem) => `- ${problem}`).join('\n'));
  process.exit(1);
}
console.log(args.includes('--terms') ? 'no forbidden terms' : `repo-lint ok (${relative(process.cwd(), repoRoot) || '.'})`);
