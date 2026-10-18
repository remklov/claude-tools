// File helpers: atomic writes, JSON, O_EXCL locks, scratch copies with linked node_modules.
import {
  closeSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync,
  realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { CwError } from './out.mjs';

export function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export const writeJson = (path, value) => writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (fallback !== undefined && error.code === 'ENOENT') return fallback;
    if (fallback !== undefined && error instanceof SyntaxError) throw new CwError(`${path} is not valid JSON: ${error.message}`);
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

export const readText = (path, fallback = null) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fallback;
  }
};

const isPidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export function tryLock(path, { staleMs = 30_000, owner = '' } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  try {
    const fd = openSync(path, 'wx');
    writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now(), owner }));
    closeSync(fd);
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const holder = readJson(path, {});
    const isStale = !isPidAlive(holder.pid) || Date.now() - (holder.at ?? 0) > staleMs;
    if (isStale) {
      try {
        unlinkSync(path);
      } catch {
        // Another process removed it first; the next attempt decides.
      }
    }
    return false;
  }
}

export function lockHolder(path) {
  return readJson(path, null);
}

export function unlock(path) {
  try {
    unlinkSync(path);
  } catch {
    // Already gone.
  }
}

// Busy-waits in small steps; used for the short state lock only.
export function withLockSync(path, fn, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!tryLock(path)) {
    if (Date.now() > deadline) throw new CwError(`Could not acquire ${path} within ${timeoutMs} ms`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  try {
    return fn();
  } finally {
    unlock(path);
  }
}

export async function withLock(path, fn, { timeoutMs = 20 * 60_000, pollMs = 2000, staleMs = 6 * 3600_000, owner, onWait } = {}) {
  const deadline = Date.now() + timeoutMs;
  let notified = false;
  while (!tryLock(path, { staleMs, owner })) {
    if (Date.now() > deadline) throw new CwError(`Timed out waiting for lock ${path}`);
    if (!notified && onWait) {
      onWait(lockHolder(path));
      notified = true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  try {
    return await fn();
  } finally {
    unlock(path);
  }
}

function findNodeModules(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.name === 'node_modules') {
        found.push(full);
        continue;
      }
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return found;
}

// Copies a working tree without .git and node_modules, then links every node_modules back in.
export function scratchCopy(source) {
  const target = mkdtempSync(join(tmpdir(), 'dw-'));
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const rel = relative(source, path);
      const parts = rel.split(/[\\/]/);
      return !parts.includes('.git') && !parts.includes('node_modules');
    },
  });
  for (const modules of findNodeModules(source)) {
    const rel = relative(source, modules);
    const link = join(target, rel);
    mkdirSync(dirname(link), { recursive: true });
    const real = lstatSync(modules).isSymbolicLink() ? realpathSync(modules) : modules;
    symlinkSync(real, link, 'dir');
  }
  return target;
}

export function removeDir(path) {
  rmSync(path, { recursive: true, force: true });
}

export const exists = (path) => existsSync(path);
export const isDir = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};
