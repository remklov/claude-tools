// Output helpers and the error type that maps to cw's exit codes.

export const EXIT = { ok: 0, failed: 1, usage: 2, precondition: 3, internal: 4 };

export class CwError extends Error {
  constructor(message, { code = EXIT.failed, details } = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const usageError = (message) => new CwError(message, { code: EXIT.usage });
export const preconditionError = (message, details) => new CwError(message, { code: EXIT.precondition, details });

const isTty = process.stdout.isTTY === true;
const paint = (code) => (text) => (isTty ? `\u001b[${code}m${text}\u001b[0m` : String(text));
export const color = { red: paint(31), green: paint(32), yellow: paint(33), dim: paint(2), bold: paint(1) };

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function print(text = '') {
  process.stdout.write(`${text}\n`);
}

export function warn(text) {
  process.stderr.write(`${color.yellow('warning:')} ${text}\n`);
}

// Renders rows of objects as an aligned plain-text table.
export function table(rows, columns) {
  if (rows.length === 0) return '';
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => String(row[column] ?? '').length)));
  const line = (cells) => cells.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ').trimEnd();
  return [line(columns), line(widths.map((width) => '-'.repeat(width))), ...rows.map((row) => line(columns.map((column) => row[column])))].join('\n');
}

// Masks values of environment variables before they reach logs or output.
export function maskEnv(text, env = {}) {
  let masked = String(text);
  for (const value of Object.values(env)) {
    if (typeof value === 'string' && value.length >= 6) masked = masked.split(value).join('***');
  }
  return masked;
}
