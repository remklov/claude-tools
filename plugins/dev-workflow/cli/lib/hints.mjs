// Rule hints (ADR 0017): patterns in the lines a change adds or changes that review rounds were
// returned for, found without judgement: a hunk that changes only whitespace (CORE-SCOPE), a declared
// name with an abbreviation outside the allowed list or a boolean without its prefix (CORE-NAMING), and
// a new module-private helper with fewer than three references (CORE-SIMPLICITY). A hint is no finding:
// the implementer checks each against its rule, and the reviewer still checks every rule itself.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tryGit } from './git.mjs';

export const HINT_RULES = ['CORE-SCOPE', 'CORE-NAMING', 'CORE-SIMPLICITY'];
const MAX_HINTS = 30;
const MAX_FILE_BYTES = 1_000_000;
const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/;

// Short forms reviewers have named, and common ones of the same kind. Words that are also plain
// English or a usual name of their own (config, env, params) are left out to keep the hints quiet.
const ABBREVIATIONS = new Set([
  'acc', 'addr', 'amt', 'arg', 'args', 'arr', 'attr', 'attrs', 'avg', 'btn', 'buf', 'calc', 'cb', 'cfg', 'cmd', 'cnt', 'ctx',
  'cur', 'curr', 'dest', 'dst', 'dt', 'el', 'elem', 'ev', 'evt', 'fn', 'func', 'idx', 'img', 'impl', 'len', 'mgr', 'msg', 'msgs',
  'num', 'obj', 'opt', 'opts', 'pkg', 'pos', 'pow', 'prev', 'ptr', 'pwd', 'qty', 'recv', 'ret', 'sel', 'seq', 'src', 'srv',
  'stmt', 'str', 'svc', 'temp', 'tmp', 'ts', 'tx', 'txn', 'usr', 'util', 'utils', 'val', 'vals', 'ver',
]);
// Acronyms that are the usual word for their thing.
const ACRONYMS = new Set(['css', 'csv', 'dns', 'gif', 'html', 'http', 'https', 'jpeg', 'jpg', 'jwt', 'pdf', 'png', 'rgb', 'sql', 'svg', 'tcp', 'ttl', 'xml']);
const VOWELLESS = /^[bcdfghjklmnpqrstvwxz]{2,4}$/;
const BOOLEAN_NAME = /^_?(?:is|has|can|should)(?:[A-Z0-9_]|$)|^(?:IS|HAS|CAN|SHOULD)_/;
const IDENT = '[A-Za-z_$][\\w$]*';

// git diff -U0 output -> [{ file, hunks: [{ start, removed: [text], added: [{ line, text }] }] }].
export function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let line = 0;
  for (const raw of String(text).split('\n')) {
    if (raw.startsWith('diff --git ')) { file = null; hunk = null; continue; }
    if (raw.startsWith('+++ ')) {
      const path = raw.slice(4).trim();
      file = path === '/dev/null' ? null : { file: path.replace(/^b\//, ''), hunks: [] };
      if (file) files.push(file);
      continue;
    }
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header && file) {
      line = Number(header[1]);
      hunk = { start: line, removed: [], added: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk || raw.startsWith('\\')) continue;
    if (raw.startsWith('-') && !raw.startsWith('---')) hunk.removed.push(raw.slice(1));
    else if (raw.startsWith('+') && !raw.startsWith('+++')) hunk.added.push({ line: line++, text: raw.slice(1) });
  }
  return files;
}

// camelCase, PascalCase, snake_case and digits apart: billingLaunchPending -> billing, launch, pending.
export const wordsOf = (name) => name
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .split(/[^A-Za-z]+/)
  .filter(Boolean)
  .map((word) => word.toLowerCase());

// The parameter names in a parameter list, without types, defaults or destructuring.
function paramNames(list) {
  const flat = list.replace(/<[^<>]*>/g, '').replace(/\{[^{}]*\}|\[[^[\]]*\]/g, '');
  return flat.split(',')
    .map((part) => new RegExp(`^\\s*(?:\\.\\.\\.)?(${IDENT})`).exec(part)?.[1])
    .filter((name) => name && !['this', 'async'].includes(name));
}

// The names a line declares: variables, functions, classes and their parameters, catch bindings.
export function declaredNames(text) {
  const names = [];
  const add = (name) => { if (name && !names.includes(name)) names.push(name); };
  for (const m of text.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(${IDENT})`, 'g'))) add(m[1]);
  for (const m of text.matchAll(new RegExp(`\\bfunction\\s*\\*?\\s*(${IDENT})?\\s*\\(([^)]*)\\)`, 'g'))) {
    add(m[1]);
    paramNames(m[2]).forEach(add);
  }
  for (const m of text.matchAll(new RegExp(`\\bclass\\s+(${IDENT})`, 'g'))) add(m[1]);
  for (const m of text.matchAll(/\(([^()]*)\)\s*(?::\s*[^=;]+?)?=>/g)) paramNames(m[1]).forEach(add);
  for (const m of text.matchAll(new RegExp(`(?:^|[=(,:]\\s*|\\basync\\s+)(${IDENT})\\s*=>`, 'g'))) add(m[1]);
  for (const m of text.matchAll(new RegExp(`\\bcatch\\s*\\(\\s*(${IDENT})`, 'g'))) add(m[1]);
  return names;
}

// The abbreviations in a name: single letters (i and j are loop indices), known short forms and
// vowelless words, minus the allowed list.
export function abbreviationsIn(name, allowed) {
  if (/^[A-Za-z]$/.test(name)) return ['i', 'j'].includes(name) || allowed.has(name.toLowerCase()) ? [] : [name];
  return wordsOf(name).filter((word) => !allowed.has(word) && !ACRONYMS.has(word) && (ABBREVIATIONS.has(word) || VOWELLESS.test(word)));
}

// The names a line declares as booleans: typed boolean, or assigned true/false, a negation, Boolean()
// or a comparison.
export function booleanNames(text) {
  const names = new Set();
  for (const m of text.matchAll(new RegExp(`(${IDENT})\\??\\s*:\\s*boolean\\b`, 'g'))) names.add(m[1]);
  const assigned = new RegExp(`\\b(?:const|let|var)\\s+(${IDENT})\\s*=\\s*(.+?);?\\s*$`).exec(text);
  if (assigned && !assigned[2].includes('=>') && !assigned[2].includes('?')) {
    const value = assigned[2];
    if (/^(?:true|false)\b|^!(?!=)|^Boolean\(/.test(value) || /\s(?:===|!==|==|!=|<=|>=|<|>)\s/.test(value)) names.add(assigned[1]);
  }
  return [...names].filter((name) => !BOOLEAN_NAME.test(name));
}

// A module-private function the line declares (no export), named in camelCase: [name] or [].
function helperName(text) {
  if (/\bexport\b/.test(text)) return null;
  const declared = new RegExp(`^\\s*(?:async\\s+)?function\\s*\\*?\\s*(${IDENT})\\s*\\(`).exec(text)
    ?? new RegExp(`^\\s*(?:const|let)\\s+(${IDENT})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:\\([^()]*\\)|${IDENT})\\s*(?::\\s*[^=]+?)?=>`).exec(text);
  const name = declared?.[1];
  return name && /^[a-z]/.test(name) ? name : null;
}

const references = (content, name) => (content.match(new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')) ?? []).length;
const exportsByName = (content, name) => new RegExp(`\\bexport\\s*\\{[^}]*\\b${name.replace(/\$/g, '\\$')}\\b`).test(content);

function readContent(workTree, file) {
  const path = join(workTree, file);
  if (!existsSync(path) || statSync(path).size > MAX_FILE_BYTES) return null;
  return readFileSync(path, 'utf8');
}

// Hints for the diff of the work tree against base (tracked changes, plus untracked files as wholly
// added). rules: the IDs that apply; allowed: the allowed abbreviations. Pure apart from reading git
// and the changed files; [] when there is nothing to scan.
export function ruleHints({ workTree, base, rules, allowed = [] }) {
  const active = new Set(rules.filter((id) => HINT_RULES.includes(id)));
  if (!active.size || !base) return [];
  const allowedSet = new Set(allowed.map((word) => word.toLowerCase()));
  const files = parseDiff(tryGit(['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', base, '--'], { cwd: workTree }) ?? '');
  for (const path of (tryGit(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: workTree }) ?? '').split('\0').filter(Boolean)) {
    const content = readContent(workTree, path);
    if (content === null || content.includes('\0')) continue;
    files.push({ file: path, hunks: [{ start: 1, removed: [], added: content.split('\n').map((text, i) => ({ line: i + 1, text })) }] });
  }
  const hints = [];
  const hint = (rule, file, line, text) => hints.push({ rule, file, line, text });
  for (const { file, hunks } of files) {
    const code = CODE_FILE.test(file);
    let content;
    for (const { start, removed, added } of hunks) {
      const squeeze = (lines) => lines.join('').replace(/\s+/g, '');
      if (active.has('CORE-SCOPE') && removed.length && added.length && squeeze(removed) === squeeze(added.map((item) => item.text))) {
        hint('CORE-SCOPE', file, start, `${added.length === 1 ? 'this line changes' : `lines ${start}–${start + added.length - 1} change`} only whitespace: leave untouched code as it was`);
      }
      if (!code) continue;
      for (const { line, text } of added) {
        if (/^\s*(?:\/\/|\*|\/\*)/.test(text)) continue;
        if (active.has('CORE-NAMING')) {
          for (const name of declaredNames(text)) {
            const short = abbreviationsIn(name, allowedSet);
            if (short.length) hint('CORE-NAMING', file, line, `${name}: ${short.join(', ')} is not an allowed abbreviation`);
          }
          for (const name of booleanNames(text)) hint('CORE-NAMING', file, line, `${name} is a boolean without is, has, can or should`);
        }
        const helper = active.has('CORE-SIMPLICITY') ? helperName(text) : null;
        if (helper) {
          content ??= readContent(workTree, file) ?? '';
          const uses = references(content, helper) - 1;
          if (uses < 3 && !exportsByName(content, helper)) {
            hint('CORE-SIMPLICITY', file, line, `${helper} has ${uses} reference${uses === 1 ? '' : 's'}: a helper needs three call sites, otherwise inline it`);
          }
        }
      }
    }
  }
  return hints;
}

// The printed hints, at most MAX_HINTS lines.
export function hintLines(hints) {
  const lines = hints.slice(0, MAX_HINTS).map((item) => `  ${item.rule} ${item.file}:${item.line}: ${item.text}`);
  if (hints.length > MAX_HINTS) lines.push(`  … and ${hints.length - MAX_HINTS} more (cw checks --json lists all)`);
  return lines;
}
