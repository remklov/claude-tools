// Glob matching for repo-relative POSIX paths, used by rule scopes, procedure triggers, complexity
// escalations and pack detection: ** spans zero or more segments, * and ? stay inside one segment,
// {a,b} nests, [abc] and [!a] are classes, \x is a literal x (also inside a class), dotfiles match,
// a trailing / means the directory and below, a leading ./ is ignored.

const cache = new Map();

// The index of the first unescaped char at or after from, or -1.
function indexOfUnescaped(pattern, char, from = 0) {
  for (let i = from; i < pattern.length; i += 1) {
    if (pattern[i] === '\\') i += 1;
    else if (pattern[i] === char) return i;
  }
  return -1;
}

// The index of the ] closing the class that opens at open, or -1; \] stays inside the class.
const classEnd = (pattern, open) => indexOfUnescaped(pattern, ']', open + 1);

// The index of the } closing the { at open, or -1; escaped braces don't count.
function closingBrace(pattern, open) {
  let depth = 0;
  for (let i = open; i < pattern.length; i += 1) {
    if (pattern[i] === '\\') i += 1;
    else if (pattern[i] === '{') depth += 1;
    else if (pattern[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(inner) {
  const parts = [];
  let level = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '\\') i += 1;
    else if (inner[i] === '{') level += 1;
    else if (inner[i] === '}') level -= 1;
    else if (inner[i] === ',' && level === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

// Expands the first closed {…} group and recurses; an unclosed { stays literal and later groups still expand.
export function expandBraces(pattern) {
  for (let open = indexOfUnescaped(pattern, '{'); open !== -1; open = indexOfUnescaped(pattern, '{', open + 1)) {
    const close = closingBrace(pattern, open);
    if (close === -1) continue;
    const prefix = pattern.slice(0, open);
    const suffix = pattern.slice(close + 1);
    return splitTopLevel(pattern.slice(open + 1, close)).flatMap((part) => expandBraces(`${prefix}${part}${suffix}`));
  }
  return [pattern];
}

// A leading ./ is dropped and a trailing / means the directory and below, as in the generated
// frontmatter, so a scope glob is written the way this matcher reads it.
export function normalizeGlob(pattern) {
  const normalized = String(pattern).replace(/^\.\//, '');
  return normalized.endsWith('/') ? `${normalized}**` : normalized;
}

const literal = (char) => (/[\\^$.*+?()[\]{}|/-]/.test(char) ? `\\${char}` : char);

function classSource(inner) {
  const negated = inner.startsWith('!');
  let source = negated ? '^' : '';
  for (let i = negated ? 1 : 0; i < inner.length; i += 1) {
    if (inner[i] === '\\') {
      i += 1;
      source += literal(inner[i]);
    } else {
      source += inner[i];
    }
  }
  return source;
}

function toRegexSource(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '\\') {
      // A trailing \ is a literal backslash.
      i += 1;
      source += literal(pattern[i] ?? '\\');
    } else if (char === '*') {
      if (pattern[i + 1] === '*') {
        const atSegmentStart = i === 0 || pattern[i - 1] === '/';
        if (atSegmentStart && pattern[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const close = classEnd(pattern, i);
      if (close === -1) source += '\\[';
      else {
        source += `[${classSource(pattern.slice(i + 1, close))}]`;
        i = close;
      }
    } else if ('^$+.()|{}'.includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return source;
}

export function globToRegExp(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  const regex = new RegExp(`^(?:${expandBraces(normalizeGlob(pattern)).map(toRegexSource).join('|')})$`);
  cache.set(pattern, regex);
  return regex;
}

export const UNCLOSED_CLASS = 'unclosed "[": escape a literal [ as \\[';

// Why a glob can't be used, with its fix; null when it is valid. An unclosed [ (this matcher would read
// it literally) and a class that doesn't compile, such as [z-a], are errors for every glob user instead
// of a silent mismatch or a crash when the glob is first matched; for a rule scope, which ends up in
// .claude/rules, rules.mjs adds what Claude Code does with an unclosed [.
export function globError(pattern) {
  for (let i = indexOfUnescaped(pattern, '['); i !== -1; i = indexOfUnescaped(pattern, '[', i + 1)) {
    const close = classEnd(pattern, i);
    if (close === -1) return UNCLOSED_CLASS;
    i = close;
  }
  try {
    globToRegExp(pattern);
  } catch (error) {
    return `invalid [ … ] class (${String(error.message).split(': ').at(-1)}). Correct the class, or escape a literal [ as \\[`;
  }
  return null;
}

const stripDot = (text) => String(text).replace(/^\.\//, '');

export const matchGlob = (path, pattern) => globToRegExp(pattern).test(stripDot(path));

export const matchAny = (path, patterns = []) => patterns.some((pattern) => matchGlob(path, pattern));
