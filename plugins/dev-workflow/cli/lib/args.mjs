// Spec-driven argv parsing. Each command declares its flags as 'string', 'boolean' or 'list';
// --json and --help are always known.

const GLOBAL = { json: 'boolean', help: 'boolean' };

// afterBoolean[i] is the boolean flag right before positionals[i] (without --), or null, so that a
// value given to a flag that takes none can be named.
export function parseArgs(argv, spec = {}) {
  const kinds = { ...GLOBAL, ...spec };
  const result = { positionals: [], afterBoolean: [], flags: {}, rest: [], unknown: [], errors: [] };
  let boolean = null;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const previous = boolean;
    boolean = null;
    if (token === '--') {
      result.rest = argv.slice(i + 1);
      break;
    }
    if (token === '-h') {
      result.flags.help = true;
      continue;
    }
    if (!token.startsWith('--') || token === '--') {
      result.positionals.push(token);
      result.afterBoolean.push(previous);
      continue;
    }
    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    const kind = kinds[name];
    if (!kind) {
      result.unknown.push(`--${name}`);
      continue;
    }
    if (kind === 'boolean') {
      if (eq !== -1) {
        result.errors.push(`--${name} takes no value`);
      } else {
        result.flags[name] = true;
        boolean = name;
      }
      continue;
    }
    let value;
    if (eq !== -1) value = token.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) value = argv[(i += 1)];
    if (value === undefined) {
      result.errors.push(`--${name} needs a value`);
      continue;
    }
    if (kind === 'list') {
      result.flags[name] = [...(result.flags[name] ?? []), value];
    } else if (name in result.flags) {
      result.errors.push(`--${name} is given more than once`);
    } else {
      result.flags[name] = value;
    }
  }
  return result;
}

// Values of a list flag: repeated and comma-separated, trimmed, empty entries dropped.
export function listFlag(flags, key) {
  return (flags[key] ?? [])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}
