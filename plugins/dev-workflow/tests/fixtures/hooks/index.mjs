// The hook stdin fixtures and a runner that starts a hook script as Claude Code does: a node process
// with the JSON input on stdin, its cwd the input's cwd. The fixtures follow the inputs logged by the P0
// spike plugin (headless CLI 2.1.303; docs/PLAN.md Appendix D; agent_transcript_path as logged by
// CLI 2.1.310, ADR 0012) with {{placeholders}} for what a test sets. Helpers here never end in .test.mjs, so the test glob does not run them.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { pluginRoot } from '../repo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULTS = { session: 'test-session', transcript: '/tmp/dw-hooks-fixture/test-session.jsonl', sessionDir: '/tmp/dw-hooks-fixture/test-session', source: 'startup', stopHookActive: false };

export const hookScript = (name) => join(pluginRoot, 'hooks', `${name}.mjs`);

// The fixture with each "{{key}}" replaced by values[key]: a whole-string placeholder takes the value
// as is (an undefined value drops the key, as in a main-session input without agent_id), one inside
// a longer string is replaced by its text.
export function hookInput(name, values = {}) {
  const all = { ...DEFAULTS, ...values };
  const fill = (node) => {
    if (Array.isArray(node)) return node.map(fill);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, fill(value)]).filter(([, value]) => value !== undefined));
    }
    if (typeof node !== 'string') return node;
    const whole = /^\{\{(\w+)\}\}$/.exec(node);
    if (whole) return all[whole[1]];
    return node.replace(/\{\{(\w+)\}\}/g, (_, key) => String(all[key] ?? ''));
  };
  return fill(JSON.parse(readFileSync(join(here, `${name}.json`), 'utf8')));
}

// Runs hooks/<script>.mjs with input on stdin. json() is the parsed stdout, null when it is empty.
export function runHookScript(script, input, { env, cwd } = {}) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [hookScript(script)], { cwd: cwd ?? input.cwd, env, input: JSON.stringify(input), encoding: 'utf8' });
  const ms = performance.now() - started;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, ms, json: () => (result.stdout.trim() ? JSON.parse(result.stdout) : null) };
}
