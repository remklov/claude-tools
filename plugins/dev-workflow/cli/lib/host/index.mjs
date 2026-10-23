// Git host detection (D7): the kind of host comes from the work repo's origin (github.com -> GitHub,
// any other host -> GitLab, a local path or no origin -> none), and config git.host overrides it.
// The adapters query an existing PR/MR and build the exact create commands of Appendix A; cw never
// runs a push or a create itself.
import { tryGit } from '../git.mjs';
import { preconditionError } from '../out.mjs';
import github from './github.mjs';
import gitlab from './gitlab.mjs';

// Single-quotes an argument for sh unless it is a plain word.
export function quote(arg) {
  const text = String(arg);
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export const firstLine = (text) => String(text ?? '').trim().split('\n')[0] ?? '';

const cleanPath = (path) => {
  const clean = String(path ?? '').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  return clean || null;
};

// { hostname, port, path, webUrl, isLocal } of a remote URL; credentials are never part of the result.
// An http(s) remote is served by the web server itself, so its web URL keeps the scheme and port; an
// ssh port is not the web port.
export function parseRemote(url) {
  const none = { hostname: null, port: null, path: null, webUrl: null, isLocal: false };
  const text = String(url ?? '').trim();
  if (!text) return none;
  let hostname;
  let port = null;
  let path;
  let web = null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    let parsed;
    try {
      parsed = new URL(text);
    } catch {
      return none;
    }
    if (parsed.protocol === 'file:') return { ...none, isLocal: true };
    hostname = parsed.hostname.toLowerCase();
    port = parsed.port || null;
    path = decodeURIComponent(parsed.pathname);
    if (/^https?:$/.test(parsed.protocol)) web = `${parsed.protocol}//${parsed.host}`;
  } else {
    // git's scp-like syntax [user@]host:path needs a colon before the first slash; anything else is a path.
    const colon = text.indexOf(':');
    const slash = text.indexOf('/');
    if (colon <= 0 || (slash !== -1 && slash < colon)) return { ...none, isLocal: true };
    hostname = text.slice(0, colon).replace(/^[^@]*@/, '').toLowerCase();
    path = text.slice(colon + 1);
  }
  const repo = cleanPath(path);
  if (!hostname) return none;
  return { hostname, port, path: repo, webUrl: repo ? `${web ?? `https://${hostname}`}/${repo}` : null, isLocal: false };
}

// The origin URL for display: user info of http(s) URLs (tokens) is dropped.
const maskUrl = (url) => (url ? url.replace(/^(https?:\/\/)[^@/]*@/i, '$1') : null);

// The host of the work repo, from `git remote get-url origin`: it applies url.<base>.insteadOf, so a
// shorthand such as gh:acme/app names github.com (git 2.54). An ssh host alias stays the alias.
export function detectHost({ workTree, config }) {
  const url = workTree ? tryGit(['remote', 'get-url', 'origin'], { cwd: workTree }) : null;
  const remote = parseRemote(url);
  const override = config?.git?.host ?? null;
  let kind = 'none';
  if (override) kind = override;
  else if (remote.hostname) kind = remote.hostname === 'github.com' ? 'github' : 'gitlab';
  return {
    kind,
    source: override ? 'config' : 'origin',
    hostname: remote.hostname,
    repo: remote.path,
    webUrl: remote.webUrl,
    remoteUrl: maskUrl(url),
    cli: kind === 'none' ? null : adapterFor(kind).cli,
  };
}

// Resolved lazily: the adapters import quote from this module.
export function adapterFor(kind) {
  if (kind === 'github') return github;
  if (kind === 'gitlab') return gitlab;
  return null;
}

// The host, or exit 3 when delivery has no PR/MR host to talk to.
export function requireHost(host, { workTree, taskId }) {
  if (host.kind !== 'none' && host.hostname && host.repo) return host;
  const origin = host.remoteUrl ? `is ${host.remoteUrl}` : 'is missing';
  const skip = `cw pr record --task ${taskId} --skipped "<reason>"`;
  if (host.kind !== 'none') {
    throw preconditionError(
      `git.host is ${host.kind}, but the origin of ${workTree} ${origin}: there is no repository on a host to open a PR/MR in.`,
      `Point origin at the ${host.kind} repository, or after asking the user end delivery with ${skip}.`,
    );
  }
  throw preconditionError(
    `The origin of ${workTree} ${origin}: no PR/MR host.`,
    `Ask the user: push and open the PR/MR by hand, or end delivery with ${skip}.`,
  );
}

// git: the prefix that reaches the work repo from the orchestrator's cwd (in-place git -C <appRoot>,
// relative to the project root, §12; worktree mode git -C <the worktree>). Never -u: --set-upstream
// writes .git/config, which the sandbox refuses (§8, S8).
export const pushCommand = ({ git, branch }) => `${git} push origin ${quote(branch)}`;
