// Exit codes, errors that always name their fix, output that honours --json, and secret masking.

export const EXIT = { ok: 0, failed: 1, usage: 2, precondition: 3, internal: 4 };

// A failure the user can act on. Codes 1-3 require a fix (§8: every failure names the fix).
export class CwError extends Error {
  constructor(message, { exitCode = EXIT.internal, fix = '', details } = {}) {
    super(message);
    if (exitCode >= EXIT.failed && exitCode <= EXIT.precondition && !fix) {
      throw new TypeError(`CwError with exit code ${exitCode} needs a fix: ${message}`);
    }
    this.name = 'CwError';
    this.exitCode = exitCode;
    this.fix = fix;
    this.details = details;
  }
}

export const failedError = (message, fix, details) => new CwError(message, { exitCode: EXIT.failed, fix, details });
export const usageError = (message, fix, details) => new CwError(message, { exitCode: EXIT.usage, fix, details });
export const preconditionError = (message, fix, details) => new CwError(message, { exitCode: EXIT.precondition, fix, details });

// Renders an error for stderr and, with --json, one JSON document for stdout. An internal error with a
// fix was diagnosed (a corrupt state file), so it prints the fix instead of a stack trace. Secrets are
// masked in the text and, value by value, in the JSON document.
export function formatError(error, { json = false, secrets = [] } = {}) {
  const known = error instanceof CwError;
  const exitCode = known ? error.exitCode : EXIT.internal;
  const message = error instanceof Error ? error.message : String(error);
  const fix = known ? error.fix : '';
  let stderr = `cw: ${message}\nFix: ${fix}\n`;
  if (exitCode === EXIT.internal) {
    const stack = error instanceof Error && error.stack ? `${error.stack}\n` : '';
    stderr = `cw: internal error: ${message}\n${fix ? `Fix: ${fix}\n` : stack}`;
  }
  const result = { exitCode, stderr: maskSecrets(stderr, secrets) };
  if (json) {
    const envelope = { ok: false, code: exitCode, error: message };
    if (fix) envelope.fix = fix;
    if (known && error.details !== undefined) envelope.details = error.details;
    result.stdout = toJson(envelope, secrets);
  }
  return result;
}

// Shorter values are not masked in text: they would garble ordinary words. cw config show replaces every
// env value as a whole, and cw config validate warns about shorter ones.
export const MASK_MIN_LENGTH = 6;

// Replaces every configured secret value of at least MASK_MIN_LENGTH characters with ***, also in the
// form JSON text gives a value with " or \ (JSON a check or a script printed). That form goes first:
// masking the raw value inside it would leave a stray \.
export function maskSecrets(text, values = []) {
  let masked = String(text);
  for (const value of values) {
    if (typeof value !== 'string' || value.length < MASK_MIN_LENGTH) continue;
    const escaped = JSON.stringify(value).slice(1, -1);
    for (const form of escaped === value ? [value] : [escaped, value]) masked = masked.split(form).join('***');
  }
  return masked;
}

// One JSON document with every string value masked before it is serialized, so masking can never
// split an escape sequence and the document stays valid JSON.
export const toJson = (value, secrets = []) =>
  `${JSON.stringify(value, (key, item) => (typeof item === 'string' ? maskSecrets(item, secrets) : item), 2)}\n`;

// Output helpers bound to injected streams, so main() can be tested in-process.
export function createOutput({ json = false, stdout, stderr, isTTY = false, secrets = [] }) {
  const write = (stream, text) => stream.write(maskSecrets(text, secrets));
  const paint = (code) => (text) => (isTTY ? `\x1b[${code}m${text}\x1b[0m` : String(text));
  return {
    json,
    color: { bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'), yellow: paint('33') },
    // Human text; suppressed with --json so stdout carries exactly one document.
    print(text = '') {
      if (!json) write(stdout, `${text}\n`);
    },
    // The one JSON document of a --json run (or of a command that always prints JSON).
    data(value) {
      stdout.write(toJson(value, secrets));
    },
    warn(text) {
      write(stderr, `cw: warning: ${text}\n`);
    },
    // Text passed through as is (a pack script's output in cw run): masked, never suppressed.
    raw(text) {
      write(stdout, text);
    },
    rawError(text) {
      write(stderr, text);
    },
    table(rows, columns) {
      if (rows.length === 0) return '';
      const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => String(row[column] ?? '').length)));
      const line = (cells) => cells.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ').trimEnd();
      return [line(columns), line(widths.map((width) => '-'.repeat(width))), ...rows.map((row) => line(columns.map((c) => row[c])))].join('\n');
    },
  };
}
