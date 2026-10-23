// GitHub adapter (gh): finds an existing PR for a branch and builds the create command (Appendix A,
// gh 2.102.0). Every command names the repository with --repo, so it works from any cwd.
import { preconditionError } from '../out.mjs';
import { run as defaultRun, which as defaultWhich } from '../proc.mjs';
import { firstLine, quote } from './index.mjs';

const repoArg = (host) => `${host.hostname}/${host.repo}`;
const loginHint = (hostname) => `gh auth login --hostname ${hostname}`;

function notInstalled(host) {
  return preconditionError('gh is not installed.', `brew install gh, then ${loginHint(host.hostname)} in your own terminal.`);
}

// { url, state, open } of the newest PR whose head is branch, or null. Auth and query failures are exit 3.
function findExisting({ host, branch, cwd, env = process.env, run = defaultRun, which = defaultWhich }) {
  if (!which('gh', env)) throw notInstalled(host);
  const result = run('gh', ['pr', 'view', branch, '--repo', repoArg(host), '--json', 'url,state'], {
    cwd,
    env: { ...env, GH_PROMPT_DISABLED: '1' },
    timeoutMs: 60_000,
  });
  if (result.error?.code === 'ENOENT') throw notInstalled(host);
  if (result.code === 0) {
    let pr;
    try {
      pr = JSON.parse(result.stdout);
    } catch {
      pr = null;
    }
    if (!pr?.url) throw preconditionError(`gh pr view printed no PR URL: ${firstLine(result.stdout)}`, `Run gh pr view ${quote(branch)} --repo ${repoArg(host)} yourself and check the output.`);
    return { url: pr.url, state: pr.state, open: pr.state === 'OPEN' };
  }
  // Exit 4 means "requires authentication" (gh help exit-codes).
  if (result.code === 4) {
    throw preconditionError(`gh needs a login for ${host.hostname}.`, `Run ${loginHint(host.hostname)} in your own terminal, then cw pr command again.`);
  }
  if (/no pull requests? found/i.test(result.stderr)) return null;
  throw preconditionError(
    `gh pr view failed for ${branch} in ${repoArg(host)}: ${firstLine(result.stderr) || `exit ${result.code}`}`,
    `Check gh auth status --hostname ${host.hostname} and that ${repoArg(host)} exists, then run cw pr command again.`,
  );
}

const createCommand = ({ host, base, branch, title, bodyFile }) =>
  `gh pr create --repo ${quote(repoArg(host))} -B ${quote(base)} -H ${quote(branch)} -t ${quote(title)} -F ${quote(bodyFile)}`;

export default { kind: 'github', cli: 'gh', installHint: 'brew install gh', loginHint, findExisting, createCommand };
