// Glob matching for repo-relative POSIX paths: **, *, ?, {a,b} (nested), [abc]. Dotfiles match.

const cache = new Map();

function expandBraces(pattern) {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];
  let depth = 0;
  for (let i = open; i < pattern.length; i += 1) {
    if (pattern[i] === '{') depth += 1;
    else if (pattern[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const inner = pattern.slice(open + 1, i);
        const parts = [];
        let level = 0;
        let start = 0;
        for (let j = 0; j < inner.length; j += 1) {
          if (inner[j] === '{') level += 1;
          else if (inner[j] === '}') level -= 1;
          else if (inner[j] === ',' && level === 0) {
            parts.push(inner.slice(start, j));
            start = j + 1;
          }
        }
        parts.push(inner.slice(start));
        const prefix = pattern.slice(0, open);
        const suffix = pattern.slice(i + 1);
        return parts.flatMap((part) => expandBraces(`${prefix}${part}${suffix}`));
      }
    }
  }
  return [pattern];
}

function toRegexSource(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        const atSegmentStart = i === 0 || pattern[i - 1] === '/';
        const followedBySlash = pattern[i + 2] === '/';
        if (atSegmentStart && followedBySlash) {
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
      const close = pattern.indexOf(']', i);
      if (close === -1) source += '\\[';
      else {
        source += `[${pattern.slice(i + 1, close).replace(/^!/, '^')}]`;
        i = close;
      }
    } else if ('\\^$+.()|{}'.includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return source;
}

export function globToRegExp(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  let normalized = pattern.replace(/^\.\//, '');
  if (normalized.endsWith('/')) normalized += '**';
  const alternatives = expandBraces(normalized).map(toRegexSource);
  const regex = new RegExp(`^(?:${alternatives.join('|')})$`);
  cache.set(pattern, regex);
  return regex;
}

export function matchGlob(path, pattern) {
  return globToRegExp(pattern).test(path.replace(/^\.\//, ''));
}

export function matchAny(path, patterns = []) {
  return patterns.some((pattern) => matchGlob(path, pattern));
}
