// YAML subset for GitHub workflow files: block maps, block lists, flow lists, quoted and plain
// scalars, comments. Anchors, multi-line strings (| >) and flow maps are skipped or kept as text.

const stripComment = (line) => {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
};

function scalar(text) {
  const value = text.trim();
  if (value === '') return null;
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map((item) => scalar(item)).filter((item) => item !== null);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function parseYaml(text) {
  const rows = [];
  let blockIndent = null;
  for (const raw of text.split('\n')) {
    const indent = raw.length - raw.trimStart().length;
    if (blockIndent !== null) {
      if (raw.trim() === '' || indent > blockIndent) continue;
      blockIndent = null;
    }
    const line = stripComment(raw).trimEnd();
    if (line.trim() === '' || line.trim() === '---') continue;
    rows.push({ indent, text: line.trim() });
    if (/:\s*[|>][-+]?$/.test(line)) blockIndent = indent;
  }
  let index = 0;

  function parseBlock(indent) {
    if (index >= rows.length) return null;
    if (rows[index].text.startsWith('- ') || rows[index].text === '-') return parseList(indent);
    return parseMap(indent);
  }

  function parseList(indent) {
    const list = [];
    while (index < rows.length && rows[index].indent === indent && (rows[index].text.startsWith('- ') || rows[index].text === '-')) {
      const content = rows[index].text.slice(1).trim();
      index += 1;
      if (content === '') list.push(parseBlock(rows[index]?.indent ?? indent + 2));
      else if (/^[^"'[]+?:(\s|$)/.test(content)) {
        rows.splice(index, 0, { indent: indent + 2, text: content });
        list.push(parseMap(indent + 2));
      } else list.push(scalar(content));
    }
    return list;
  }

  function parseMap(indent) {
    const map = {};
    while (index < rows.length && rows[index].indent === indent && !rows[index].text.startsWith('- ')) {
      const match = /^("[^"]*"|'[^']*'|[^:]+?):(?:\s+(.*))?$/.exec(rows[index].text);
      index += 1;
      if (!match) continue;
      const key = String(scalar(match[1]));
      const rest = match[2];
      if (rest !== undefined && rest !== '' && !/^[|>]/.test(rest)) map[key] = scalar(rest);
      else if (index < rows.length && rows[index].indent > indent) map[key] = parseBlock(rows[index].indent);
      else if (index < rows.length && rows[index].indent === indent && rows[index].text.startsWith('- ')) map[key] = parseList(indent);
      else map[key] = null;
    }
    return map;
  }

  return parseBlock(rows[0]?.indent ?? 0) ?? {};
}
