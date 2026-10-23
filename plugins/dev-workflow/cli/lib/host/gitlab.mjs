// GitLab adapter (glab): finds an existing MR for a branch and builds the create command (Appendix A,
// glab 1.122.0). glab documents no exit codes, so results are read from its JSON. Every command names
// the repository with -R <web URL>, so it works from any cwd.
import { preconditionError } from '../out.mjs';
import { run as defaultRun, which as defaultWhich } from '../proc.mjs';
import { firstLine, quote } from './index.mjs';

const loginHint = (hostname) => `glab auth login --hostname ${hostname}`;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const toResult = (mr) => ({ url: mr.web_url, state: mr.state, open: mr.state === 'opened' });

// { url, state, open } of the MR whose source is branch (an open one first), or null.
function findExisting({ host, branch, cwd, env = process.env, run = defaultRun, which = defaultWhich }) {
  if (!which('glab', env)) {
    throw preconditionError('glab is not installed.', `brew install glab, then ${loginHint(host.hostname)} in your own terminal.`);
  }
  const options = { cwd, env, timeoutMs: 60_000 };
  const view = run('glab', ['mr', 'view', branch, '-R', host.webUrl, '-F', 'json'], options);
  const viewed = view.code === 0 ? parseJson(view.stdout) : undefined;
  if (viewed?.web_url) return toResult(viewed);
  // view fails when the branch has no MR; the list then tells "none" from a failing query.
  const list = run('glab', ['mr', 'list', '--source-branch', branch, '--all', '-R', host.webUrl, '-F', 'json'], options);
  const listed = list.code === 0 ? parseJson(list.stdout) : undefined;
  if (Array.isArray(listed)) {
    if (!listed.length) return null;
    return toResult(listed.find((mr) => mr.state === 'opened') ?? listed[0]);
  }
  const reason = firstLine(list.stderr) || firstLine(view.stderr) || `exit ${list.code}`;
  // git.host sets only the kind: the host name and repository stay those of the origin URL.
  throw preconditionError(
    `Could not query ${host.hostname} with glab: ${reason}`,
    `Check glab auth status --hostname ${host.hostname}; log in with ${loginHint(host.hostname)} in your own terminal. If ${host.hostname} is an ssh host alias (~/.ssh/config), cw cannot tell the real host: ask the user to push and open the merge request by hand, then run cw pr record --task <id> --url <url>. If ${host.hostname} is a GitHub server, set git.host to github in .claude/dev-workflow/config.json.`,
  );
}

// Never --remove-source-branch (feature branches stay) and never --draft.
const createCommand = ({ host, base, branch, title, bodyFile }) =>
  `glab mr create -R ${quote(host.webUrl)} -s ${quote(branch)} -b ${quote(base)} -t ${quote(title)} --description-file ${quote(bodyFile)} -y`;

export default { kind: 'gitlab', cli: 'glab', installHint: 'brew install glab', loginHint, findExisting, createCommand };
