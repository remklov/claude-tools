// Process helpers: synchronous runs with captured output, shell commands with logs and timeouts.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
    stderr: result.stderr ?? (result.error ? String(result.error.message) : ''),
    error: result.error,
  };
}

export function commandExists(command) {
  return run('sh', ['-c', `command -v ${command}`]).code === 0;
}

// Runs a shell command, streams output to a log file and keeps the tail. Resolves, never rejects.
export function shell(command, { cwd, env, logFile, timeoutMs = 15 * 60_000, tailLines = 40 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    if (logFile) mkdirSync(dirname(logFile), { recursive: true });
    const log = logFile ? createWriteStream(logFile) : null;
    const child = spawn('sh', ['-c', command], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    const collect = (chunk) => {
      log?.write(chunk);
      buffer = (buffer + chunk.toString()).slice(-64 * 1024);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      log?.end();
      const tail = buffer.split('\n').slice(-tailLines).join('\n');
      resolve({ code: timedOut ? 124 : code ?? 1, timedOut, durationMs: Date.now() - started, tail, output: buffer });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      log?.end();
      resolve({ code: 127, timedOut: false, durationMs: Date.now() - started, tail: String(error.message), output: String(error.message) });
    });
  });
}
