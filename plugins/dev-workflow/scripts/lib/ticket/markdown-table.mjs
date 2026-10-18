// Backlog as pipe tables in a Markdown file (e.g. plan/NEXT_STEPS.MD). Never stores "in progress".
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tryGit } from '../git.mjs';
import { CwError } from '../out.mjs';

export function splitCells(line) {
  const cells = [];
  let current = '';
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      current += '\\|';
      i += 1;
    } else if (body[i] === '|') {
      cells.push(current.trim());
      current = '';
    } else current += body[i];
  }
  cells.push(current.trim());
  return cells;
}

// Parses every table whose header contains the ID and status columns.
export function parseBacklog(text, columns) {
  const lines = text.split('\n');
  const rows = [];
  let section = '';
  let header = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) {
      section = line.replace(/^#+\s*/, '').trim();
      header = null;
      continue;
    }
    if (!line.trim().startsWith('|')) {
      header = null;
      continue;
    }
    const cells = splitCells(line);
    if (!header) {
      if (cells.includes(columns.id) && cells.includes(columns.status) && /^\s*\|?\s*:?-+/.test(lines[i + 1] ?? '')) {
        header = cells;
        i += 1;
      }
      continue;
    }
    const record = Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']));
    rows.push({ id: record[columns.id], status: record[columns.status], cells: record, section, line: i, raw: line });
  }
  return rows;
}

export function suggestedOrder(text) {
  const start = text.search(/^#{1,6}\s+Suggested order\s*$/im);
  if (start === -1) return [];
  const rest = text.slice(start).split('\n').slice(1);
  const end = rest.findIndex((line) => /^#{1,6}\s/.test(line));
  const block = (end === -1 ? rest : rest.slice(0, end)).join('\n');
  return [...block.matchAll(/\*\*([A-Z]+-\d+[a-z]?)\*\*|\b([A-Z]+-\d+[a-z]?)\b/g)].map((m) => m[1] ?? m[2]);
}

export function createMarkdownTableAdapter(ctx, profile) {
  const config = profile.tickets;
  const path = join(ctx.repoRoot, config.file);
  const read = (ref) => {
    if (!ref) return readFileSync(path, 'utf8');
    const text = tryGit(['show', `${ref}:${config.file}`], { cwd: ctx.repoRoot });
    if (text === null) throw new CwError(`${config.file} not found at ${ref}`);
    return text;
  };
  const rows = (ref) => parseBacklog(read(ref), config.columns);
  const idRegex = /[A-Z]+-\d+[a-z]?/g;

  return {
    name: 'markdown-table',
    file: config.file,
    list({ open = false, ref } = {}) {
      return rows(ref).filter((row) => !open || row.status.startsWith(config.statusOpen));
    },
    show(id, { ref } = {}) {
      return rows(ref).find((row) => row.id === id) ?? null;
    },
    exists(id, { ref } = {}) {
      return rows(ref).some((row) => row.id === id);
    },
    isOpen(row) {
      return row.status.startsWith(config.statusOpen);
    },
    dependencies(id, { ref } = {}) {
      const all = rows(ref);
      const row = all.find((item) => item.id === id);
      if (!row) return [];
      const cell = row.cells[config.dependsColumn] ?? '';
      const ids = new Set(all.map((item) => item.id));
      return [...new Set(cell.match(idRegex) ?? [])].filter((dep) => dep !== id && ids.has(dep));
    },
    order({ ref } = {}) {
      return suggestedOrder(read(ref));
    },
    done(id) {
      const text = read();
      const row = parseBacklog(text, config.columns).find((item) => item.id === id);
      if (!row) return false;
      const lines = text.split('\n');
      lines.splice(row.line, 1);
      writeFileSync(path, lines.join('\n'));
      return true;
    },
    newRow({ section, id, cells }) {
      const text = read();
      const all = parseBacklog(text, config.columns);
      const inSection = all.filter((row) => row.section.startsWith(section));
      if (!inSection.length) throw new CwError(`No table in section "${section}" of ${config.file}`);
      const header = Object.keys(inSection[0].cells);
      const values = header.map((name) => (name === config.columns.id ? id : name === config.columns.status ? config.statusOpen : cells[name] ?? '—'));
      const lines = text.split('\n');
      lines.splice(inSection.at(-1).line + 1, 0, `| ${values.join(' | ')} |`);
      writeFileSync(path, lines.join('\n'));
      return id;
    },
    allIds({ ref } = {}) {
      return rows(ref).map((row) => row.id);
    },
  };
}

// Three-way merge of a backlog file keyed by row ID (git merge driver, spec 02 §4.7).
// Deletions win, additions from both sides are kept, a row changed on both sides keeps "ours".
export function mergeBacklog(baseText, oursText, theirsText, columns) {
  const index = (text) => new Map(parseBacklog(text, columns).map((row) => [row.id, row]));
  const base = index(baseText);
  const ours = index(oursText);
  const theirs = index(theirsText);
  const lines = oursText.split('\n');
  const deletions = new Set();
  const replacements = new Map();
  const conflicts = [];
  for (const [id, row] of ours) {
    const inBase = base.get(id);
    const inTheirs = theirs.get(id);
    if (inBase && !inTheirs) deletions.add(row.line);
    else if (inBase && inTheirs && inTheirs.raw !== inBase.raw) {
      if (row.raw === inBase.raw) replacements.set(row.line, inTheirs.raw);
      else if (row.raw !== inTheirs.raw) conflicts.push(id);
    }
  }
  const additions = [...theirs.values()].filter((row) => !base.has(row.id) && !ours.has(row.id));
  const out = [];
  const oursRows = [...ours.values()];
  lines.forEach((line, i) => {
    if (deletions.has(i)) return;
    out.push(replacements.get(i) ?? line);
    const row = oursRows.find((item) => item.line === i);
    if (!row) return;
    const sameSection = (item) => item.section === row.section;
    const lastOfSection = oursRows.filter(sameSection).at(-1) === row;
    if (lastOfSection) for (const add of additions.filter(sameSection)) out.push(add.raw);
  });
  const placed = new Set(oursRows.map((row) => row.section));
  for (const add of additions.filter((row) => !placed.has(row.section))) out.push(add.raw);
  for (const id of conflicts) out.push(`<!-- dw: ${id} changed on both sides; kept ours -->`);
  return { text: out.join('\n'), conflicts };
}
