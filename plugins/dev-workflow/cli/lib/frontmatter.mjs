// A small frontmatter reader for procedures and other Markdown with metadata: scalars, inline lists
// [a, b], block lists (- item) and one level of nested keys. Anything else is an error with a line.
import { usageError } from './out.mjs';

const unquote = (value) => {
  const text = value.trim();
  return /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text;
};

// Splits on commas outside quotes and braces, so ["**/*.{ts,tsx}", "a,b"] keeps both items whole.
const splitItems = (inner) => {
  const items = [];
  let current = '';
  let quote = null;
  let depth = 0;
  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      items.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  items.push(current);
  return items;
};

const parseValue = (raw) => {
  const text = raw.trim();
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) return undefined;
    const inner = text.slice(1, -1).trim();
    return inner ? splitItems(inner).map(unquote).filter((item) => item !== '') : [];
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  return unquote(text);
};

// Returns { data, body }. A file without frontmatter returns { data: {}, body: text }.
export function parseFrontmatter(text, source = 'file') {
  const normalized = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { data: {}, body: normalized };
  const data = {};
  let parent = null; // the key whose nested map or list is open
  let listKey = null; // { target, key } of an open block list
  const fail = (index, why) => {
    throw usageError(`${source}: frontmatter line ${index + 2}: ${why}`, 'Use key: value, key: [a, b], a "- item" list or one level of nested keys.');
  };
  match[1].split('\n').forEach((line, index) => {
    if (line.trim() === '' || line.trim().startsWith('#')) return;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      if (!listKey) fail(index, 'a list item without a key');
      const value = parseValue(trimmed.slice(2));
      listKey.target[listKey.key] = [...(Array.isArray(listKey.target[listKey.key]) ? listKey.target[listKey.key] : []), value];
      return;
    }
    const pair = /^([A-Za-z][\w-]*):(.*)$/.exec(trimmed);
    if (!pair) fail(index, `cannot read "${trimmed}"`);
    const [, key, rest] = pair;
    if (indent === 0) {
      parent = null;
      listKey = null;
      if (rest.trim() === '') {
        data[key] = {};
        parent = key;
        listKey = { target: data, key };
      } else {
        const value = parseValue(rest);
        if (value === undefined) fail(index, `an unclosed list for ${key}`);
        data[key] = value;
      }
      return;
    }
    if (!parent) fail(index, `"${key}" is indented but has no parent key`);
    if (Array.isArray(data[parent])) fail(index, `"${parent}" mixes a list and nested keys`);
    if (rest.trim() === '') {
      data[parent][key] = [];
      listKey = { target: data[parent], key };
      return;
    }
    const value = parseValue(rest);
    if (value === undefined) fail(index, `an unclosed list for ${key}`);
    data[parent][key] = value;
    listKey = null;
  });
  return { data, body: normalized.slice(match[0].length) };
}
