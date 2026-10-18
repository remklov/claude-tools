// Minimal argv parser: positionals, --flag, --key value, --key=value, repeated keys, and "--".

const BOOLEAN_FLAGS = new Set([
  'json', 'write', 'check', 'detect', 'yes', 'fresh', 'hook', 'changed', 'all', 'open', 'available',
  'next', 'force', 'last', 'quiet', 'help', 'dry-run', 'no-fetch', 'stdin',
]);

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = arg.slice(2, eq === -1 ? undefined : eq);
    let value;
    if (eq !== -1) value = arg.slice(eq + 1);
    else if (BOOLEAN_FLAGS.has(key)) value = true;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) value = argv[++i];
    else value = true;
    if (key in flags) flags[key] = [].concat(flags[key], value);
    else flags[key] = value;
  }
  return { positionals, flags, rest };
}

// Returns a flag as a list (for flags that may repeat or take comma lists).
export function listFlag(flags, key) {
  const value = flags[key];
  if (value === undefined || value === true) return [];
  return [].concat(value).flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean);
}
