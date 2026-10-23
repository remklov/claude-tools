// File helpers: atomic writes, JSON, the O_EXCL state lock and an mtime-keyed cache.
import { randomBytes } from 'node:crypto';
import {
  closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { CwError, preconditionError } from './out.mjs';

// Writes a temp file next to path, then renames it over path.
export function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export const writeJson = (path, value) => writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);

// The parsed file; a missing file returns fallback (or throws without one); broken JSON is exit 4.
export function readJson(path, fallback) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CwError(`${path} is not valid JSON: ${error.message}`, { fix: `Repair or delete ${path}.` });
  }
}

export function readText(path, fallback = null) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fallback;
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const isPidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

function readHolder(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function isStale(path, holder, staleMs) {
  if (!holder) {
    try {
      return Date.now() - statSync(path).mtimeMs > staleMs;
    } catch {
      return false;
    }
  }
  if (holder.host === hostname() && !isPidAlive(holder.pid)) return true;
  return Date.now() - Date.parse(holder.at) > staleMs;
}

// Takes a stale lock out of the way without removing a fresh lock that replaced it meanwhile.
function takeOver(path, judged) {
  const aside = `${path}.stale.${process.pid}.${randomBytes(4).toString('hex')}`;
  try {
    renameSync(path, aside);
  } catch {
    return;
  }
  const moved = readHolder(aside);
  if (moved && judged && moved.nonce !== judged.nonce) {
    try {
      linkSync(aside, path);
    } catch {
      // Someone else holds the lock now; the next attempt decides.
    }
  }
  try {
    unlinkSync(aside);
  } catch {
    // Already gone.
  }
}

// Acquires an O_EXCL lock file holding { pid, host, at, nonce }. Synchronous; returns { release }.
export function acquireLock(path, { timeoutMs = 5000, staleMs = 30_000, pollMs = 25 } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  const nonce = randomBytes(8).toString('hex');
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString(), nonce }));
      closeSync(fd);
      return {
        release() {
          if (readHolder(path)?.nonce !== nonce) return;
          try {
            unlinkSync(path);
          } catch {
            // Already gone.
          }
        },
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const holder = readHolder(path);
    if (isStale(path, holder, staleMs)) {
      takeOver(path, holder);
      continue;
    }
    if (Date.now() > deadline) {
      const by = holder ? ` (held by pid ${holder.pid} on ${holder.host} since ${holder.at})` : '';
      throw preconditionError(`Could not lock ${path} within ${timeoutMs / 1000} s${by}.`, `Retry; if no cw process is running, delete ${path}.`);
    }
    sleep(pollMs);
  }
}

export function withLock(path, fn, options) {
  const lock = acquireLock(path, options);
  try {
    return fn();
  } finally {
    lock.release();
  }
}

// Returns the cached value while every input keeps its mtime and size; recomputes otherwise.
export function cachedByMtime(cacheFile, inputs, compute) {
  const key = inputs.map((input) => {
    try {
      const stat = statSync(input);
      return [input, stat.mtimeMs, stat.size];
    } catch {
      return [input, null, null];
    }
  });
  const cached = readText(cacheFile);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (JSON.stringify(parsed.key) === JSON.stringify(key)) return parsed.value;
    } catch {
      // Recompute.
    }
  }
  const value = compute();
  try {
    writeJson(cacheFile, { key, value });
  } catch {
    // A cache that cannot be written is only slower.
  }
  return value;
}
