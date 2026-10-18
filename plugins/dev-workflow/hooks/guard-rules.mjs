// Guard rules for Bash and Agent calls (spec 06 §4): shell parsing and the deny catalog.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { expandHome } from '../scripts/lib/ctx.mjs';
import { matchAny } from '../scripts/lib/glob.mjs';
import { roleOf } from './hook-lib.mjs';

// --- shell-ish parsing ---------------------------------------------------------------------------

export function stripHeredocs(command) {
  const lines = command.split('\n');
  const out = [];
  let terminator = null;
  for (const line of lines) {
    if (terminator) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    const match = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(line);
    if (match) terminator = match[1];
    out.push(line);
  }
  return out.join('\n');
}

export function splitSegments(command) {
  const text = stripHeredocs(command);
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const two = text.slice(i, i + 2);
    if (quote) {
      if (char === '\\' && quote === '"') {
        current += char + (text[i + 1] ?? '');
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (two === '&&' || two === '||' || two === '$(') {
      segments.push(current);
      current = '';
      i += 1;
      continue;
    }
    if (char === ';' || char === '|' || char === '\n' || char === '`' || char === ')' || char === '(') {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

export function tokenize(segment) {
  const tokens = [];
  let current = '';
  let quote = null;
  let hasToken = false;
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasToken = true;
      continue;
    }
    if (char === '\\' && i + 1 < segment.length) {
      current += segment[i + 1];
      i += 1;
      hasToken = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasToken || current) tokens.push(current);
      current = '';
      hasToken = false;
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken || current) tokens.push(current);
  // Drop env assignments and harmless wrappers in front of the real command.
  while (tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]) || ['sudo', 'env', 'command', 'exec', 'nohup', 'time'].includes(tokens[0]))) tokens.shift();
  if (tokens[0] === 'timeout' && tokens.length > 2) tokens.splice(0, 2);
  return tokens;
}

// git -C <dir> / --git-dir … <sub>: returns { sub, args, dirs }
function gitCall(tokens) {
  if (tokens[0] !== 'git') return null;
  const dirs = [];
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (tokens[i] === '-C' || tokens[i] === '--git-dir' || tokens[i] === '--work-tree') {
      dirs.push(tokens[i + 1]);
      i += 2;
    } else if (tokens[i] === '-c') i += 2;
    else i += 1;
  }
  return { sub: tokens[i], args: tokens.slice(i + 1), dirs };
}

const startsWithWords = (tokens, words) => words.every((word, i) => tokens[i] === word);

function commandMatches(tokens, raw, pattern) {
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) return new RegExp(pattern.slice(1, -1)).test(raw);
  const words = pattern.trim().split(/\s+/);
  if (startsWithWords(tokens, words)) return true;
  // `npx drizzle-kit push` and similar wrappers.
  if (['npx', 'pnpm', 'yarn', 'bunx'].includes(tokens[0]) && startsWithWords(tokens.slice(1), words)) return true;
  return false;
}

function redirectTargets(segment) {
  return [...segment.matchAll(/(?:^|[^0-9&])>>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g)].map((m) => m[1].replace(/^["']|["']$/g, ''));
}

// --- the guard -----------------------------------------------------------------------------------

const deny = (id, reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${id}: ${reason}` } });

export function evaluate({ input, ctx, profile, guards }) {
  const role = roleOf(input.agent_type);
  const isWorkflowAgent = role && role !== 'orchestrator';
  const isReadOnlyRole = role === 'reviewer' || role === 'investigator';

  if (input.tool_name === 'Agent') {
    const call = input.tool_input ?? {};
    if (call.model || call.effort) return deny('G-AGENT-OVERRIDE', 'Model and effort are fixed per agent; call the agent without them.');
    if (/fable/i.test(String(call.subagent_type ?? ''))) return deny('G-NO-FABLE', 'Fable models are not used in this setup.');
    const local = join(ctx.repoRoot, '.claude', 'agents', `${String(call.subagent_type ?? '').replace(/^.*:/, '')}.md`);
    if (existsSync(local) && /^model:\s*\S*fable/im.test(readFileSync(local, 'utf8'))) return deny('G-NO-FABLE', 'Fable models are not used in this setup.');
    return null;
  }
  if (input.tool_name !== 'Bash') return null;
  const raw = String(input.tool_input?.command ?? '');
  const cwd = input.cwd || ctx.cwd;
  const protectedCheckout = expandHome(profile.isolation.protectedCheckout) ?? ctx.mainCheckout;
  const inWorktree = ctx.isLinkedWorktree;
  const ports = [...new Set([...profile.guards.ports, ...guards.ports])].filter(Boolean);
  const commands = [...new Set([...profile.guards.commands, ...guards.commands])];
  const resolvePath = (path) => resolve(cwd, expandHome(path));
  const underProtected = (path) => {
    const abs = resolvePath(path);
    if (abs === ctx.commonDir || abs.startsWith(`${ctx.commonDir}/`)) return false; // task files and git objects
    return (abs === protectedCheckout || abs.startsWith(`${protectedCheckout}/`)) && !(abs === ctx.repoRoot || abs.startsWith(`${ctx.repoRoot}/`));
  };

  for (const segment of splitSegments(raw)) {
    const tokens = tokenize(segment);
    if (!tokens.length) continue;
    const git = gitCall(tokens);

    if (git?.sub === 'push' && git.args.some((arg) => arg === '--force' || arg === '-f' || arg.startsWith('--force-with-lease') || /^\+/.test(arg))) {
      return deny('G-FORCE', 'Force pushes are not part of the workflow. Ask the user.');
    }
    if (!isWorkflowAgent) continue;

    if (git?.sub === 'push' || startsWithWords(tokens, ['gh', 'pr', 'create']) || startsWithWords(tokens, ['gh', 'pr', 'merge'])
      || startsWithWords(tokens, ['glab', 'mr', 'create']) || startsWithWords(tokens, ['glab', 'mr', 'merge'])) {
      return deny('G-PUSH', 'Only the orchestrator pushes and opens pull requests, after the user confirms.');
    }
    if (profile.isolation.mode === 'worktree' && inWorktree) {
      const targets = [];
      if (['cd', 'pushd'].includes(tokens[0]) && tokens[1]) targets.push(tokens[1]);
      if (git) targets.push(...git.dirs);
      targets.push(...tokens.slice(1).filter((token) => isAbsolute(expandHome(token) ?? '') || token.startsWith('~')));
      if (targets.some((target) => underProtected(target))) {
        return deny('G-MAIN-CHECKOUT', `The main checkout runs the owner's environment. Work only inside your worktree ${ctx.repoRoot}.`);
      }
    }
    if (isReadOnlyRole) {
      const writes = ['commit', 'add', 'checkout', 'switch', 'reset', 'rebase', 'stash', 'merge', 'cherry-pick', 'restore', 'clean', 'tag', 'am', 'apply', 'rm', 'mv'];
      if (git && (writes.includes(git.sub) || (git.sub === 'branch' && git.args.some((a) => ['-d', '-D', '-m', '-M', '--delete', '--move'].includes(a))) || (git.sub === 'worktree' && ['add', 'remove', 'prune'].includes(git.args[0])))) {
        return deny('G-GIT-WRITE-R', 'Reviewers and investigators don\'t change the repository. Use `cw mutate` for mutation checks.');
      }
      const inRepoWrite = (path) => {
        const abs = resolvePath(path);
        return !abs.startsWith('/tmp/') && !abs.startsWith('/dev/') && !abs.startsWith(process.env.TMPDIR ?? '/nonexistent') && (abs.startsWith(`${ctx.mainCheckout}/`) || abs.startsWith(`${ctx.repoRoot}/`));
      };
      const isFileWrite = (tokens[0] === 'sed' && tokens.some((t) => /^-i/.test(t))) || (tokens[0] === 'perl' && tokens.some((t) => /^-p?i/.test(t)))
        || (['rm', 'mv', 'cp', 'tee', 'touch', 'truncate'].includes(tokens[0]) && tokens.slice(1).filter((t) => !t.startsWith('-')).some(inRepoWrite))
        || redirectTargets(segment).some(inRepoWrite);
      if (isFileWrite) return deny('G-FILE-WRITE-R', 'Reviewers and investigators don\'t change files in the repository. Work in a scratch copy (`cw mutate`).');
    }
    if (guards.dependencyCommands.some((pattern) => commandMatches(tokens, segment, pattern))) {
      return deny('G-DEPS', 'Dependency changes need the owner. Stop and report `blocked` with the package and version you need.');
    }
    const hit = commands.find((pattern) => commandMatches(tokens, segment, pattern));
    if (hit) return deny('G-COMMANDS', `\`${hit}\` is not allowed in this project (guards in .claude/workflow/profile.json and the active packs).`);
    const port = ports.find((p) => new RegExp(`(:${p}\\b|--port[= ]${p}\\b|\\s-p\\s+${p}\\b|PORT=${p}\\b)`).test(segment));
    if (port) return deny('G-PORTS', `Port ${port} belongs to the owner's environment (guards.ports). Use the test setup instead.`);
    if (profile.guards.devServer === 'never') {
      const isDevServer = startsWithWords(tokens, ['npm', 'run', 'dev']) || startsWithWords(tokens, ['npm', 'start']) || tokens[0] === 'vite'
        || startsWithWords(tokens, ['npx', 'vite']) || startsWithWords(tokens, ['next', 'dev']) || startsWithWords(tokens, ['npx', 'next', 'dev'])
        || startsWithWords(tokens, ['pnpm', 'dev']) || startsWithWords(tokens, ['yarn', 'dev']);
      if (isDevServer) return deny('G-DEVSERVER', 'No dev servers in this project. Verify with tests and typecheck and list browser checks as `manual` open points.');
    }
    const writeTargets = [...redirectTargets(segment), ...(['cp', 'mv', 'tee'].includes(tokens[0]) ? [tokens.at(-1)] : [])];
    const protectedPath = writeTargets.find((target) => {
      const abs = resolvePath(target);
      const rel = abs.startsWith(`${ctx.repoRoot}/`) ? abs.slice(ctx.repoRoot.length + 1) : null;
      return rel && matchAny(rel, profile.guards.writePaths);
    });
    if (protectedPath) return deny('G-WRITE-PATHS', `${protectedPath} is protected (guards.writePaths).`);
  }
  return null;
}
