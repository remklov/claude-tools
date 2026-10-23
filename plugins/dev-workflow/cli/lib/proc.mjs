// Process helpers: synchronous runs with captured output, a PATH lookup without spawning, and
// shell commands with a log file, a timeout and the output tail.
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, createWriteStream, mkdirSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { maskSecrets } from './out.mjs';

export function run(command, args = [], { cwd, env, input, timeoutMs = 120_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    input,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: result.status ?? (result.error ? 127 : 1),
    stdout: result.stdout ?? '',
    stderr: result.stderr || (result.error ? String(result.error.message) : ''),
    error: result.error,
  };
}

// The absolute path of an executable on PATH, or null. Scans PATH instead of spawning a shell.
export function which(command, env = process.env) {
  const isExecutable = (path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (isAbsolute(command)) return isExecutable(command) ? command : null;
  for (const dir of String(env.PATH ?? '').split(delimiter)) {
    if (dir && isExecutable(join(dir, command))) return join(dir, command);
  }
  return null;
}

// Masks secrets (maskSecrets) in text that arrives in chunks. The end of a chunk that may begin a
// secret is held back until the next chunk, so a secret split across two chunks is masked as well.
function secretMasker(secrets) {
  const values = secrets.filter((value) => typeof value === 'string' && value.length >= 6);
  // maskSecrets also masks the JSON-escaped form, so a chunk may end in the start of either form.
  const forms = [...new Set(values.flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]))];
  let held = '';
  const startOfSecret = (text) => {
    let keep = 0;
    for (const value of forms) {
      for (let n = Math.min(value.length - 1, text.length); n > keep; n -= 1) {
        if (text.endsWith(value.slice(0, n))) {
          keep = n;
          break;
        }
      }
    }
    return keep;
  };
  return {
    push(chunk) {
      const text = maskSecrets(held + chunk, values);
      const keep = startOfSecret(text);
      held = text.slice(text.length - keep);
      return text.slice(0, text.length - keep);
    },
    end() {
      const rest = held;
      held = '';
      return rest;
    },
  };
}

// Runs a shell command, streams its output to logFile and keeps the tail. Resolves, never rejects,
// and only once the log is written. secrets are masked in the log as it is written (§8), so an
// interrupted cw leaves no secret behind; the returned tail and output are not masked.
// killGroup runs it in its own process group and kills the whole group on timeout: otherwise a
// grandchild (npm -> vitest) keeps the output pipe open and the timeout waits for it.
export function shell(command, { cwd, env, logFile, secrets = [], timeoutMs = 15 * 60_000, tailLines = 40, killGroup = false } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    if (logFile) mkdirSync(dirname(logFile), { recursive: true });
    const log = logFile ? createWriteStream(logFile) : null;
    const masker = log && secrets.length ? secretMasker(secrets) : null;
    const decoder = new StringDecoder('utf8');
    const child = spawn('sh', ['-c', command], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: killGroup });
    const kill = (signal) => {
      try {
        if (killGroup) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // Already gone.
      }
    };
    let buffer = '';
    const collect = (chunk) => {
      const text = masker ? masker.push(decoder.write(chunk)) : chunk;
      if (log && text.length) log.write(text);
      buffer = (buffer + chunk.toString()).slice(-64 * 1024);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    let finished = false;
    const finish = (code, output) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const tail = output.split('\n').slice(-tailLines).join('\n');
      const done = () => resolve({ code, timedOut, durationMs: Date.now() - started, tail, output });
      if (!log) return done();
      const rest = masker ? `${masker.push(decoder.end())}${masker.end()}` : '';
      if (rest) log.write(rest);
      // end's callback runs once the writes are flushed (or failed): the caller reads the log next.
      log.end(done);
    };
    child.on('close', (code) => finish(timedOut ? 124 : (code ?? 1), buffer));
    child.on('error', (error) => finish(127, String(error.message)));
  });
}
