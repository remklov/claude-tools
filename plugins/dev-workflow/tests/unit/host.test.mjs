import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import github from '../../cli/lib/host/github.mjs';
import gitlab from '../../cli/lib/host/gitlab.mjs';
import { detectHost, parseRemote, pushCommand, quote, requireHost } from '../../cli/lib/host/index.mjs';
import { gitIn, makeInPlace } from '../fixtures/repo.mjs';

// In-process git calls below must not read the developer's git config.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const GITHUB = { kind: 'github', hostname: 'github.com', repo: 'acme/app', webUrl: 'https://github.com/acme/app' };
const GITLAB = { kind: 'gitlab', hostname: 'gitlab.example.com', repo: 'group/sub/app', webUrl: 'https://gitlab.example.com/group/sub/app' };

// A runner that answers in order and records each call.
function runner(...answers) {
  const calls = [];
  return {
    calls,
    run: (command, args) => {
      calls.push([command, ...args]);
      return { code: 0, stdout: '', stderr: '', ...answers.shift() };
    },
  };
}
const installed = () => '/usr/local/bin/stub';
const missing = () => null;
const exitCode = (code) => (error) => error.exitCode === code;

test('parseRemote reads scp, ssh, https and local remotes and drops credentials', () => {
  assert.deepEqual(parseRemote('git@github.com:acme/app.git'), {
    hostname: 'github.com', port: null, path: 'acme/app', webUrl: 'https://github.com/acme/app', isLocal: false,
  });
  assert.equal(parseRemote('https://github.com/acme/app').webUrl, 'https://github.com/acme/app');
  const token = parseRemote('https://user:s3cr3t-token@gitlab.example.com/group/sub/app.git');
  assert.equal(token.webUrl, 'https://gitlab.example.com/group/sub/app');
  assert.ok(!JSON.stringify(token).includes('s3cr3t'));
  assert.deepEqual(parseRemote('ssh://git@gitlab.example.com:2222/a/b/c.git'), {
    hostname: 'gitlab.example.com', port: '2222', path: 'a/b/c', webUrl: 'https://gitlab.example.com/a/b/c', isLocal: false,
  });
  for (const local of ['/tmp/x/remote.git', 'file:///tmp/x.git', '../sibling.git', 'C/dir:with-colon']) assert.equal(parseRemote(local).isLocal, true, local);
  assert.equal(parseRemote('').hostname, null);
});

test('parseRemote keeps the scheme and port of an http(s) remote in the web URL', () => {
  const ported = parseRemote('https://oauth2:s3cr3t-token@GitLab.example.com:8443/group/app.git');
  assert.deepEqual([ported.hostname, ported.port, ported.webUrl], ['gitlab.example.com', '8443', 'https://gitlab.example.com:8443/group/app']);
  assert.ok(!JSON.stringify(ported).includes('s3cr3t'));
  assert.equal(parseRemote('http://gitlab.local/group/app.git').webUrl, 'http://gitlab.local/group/app');
  assert.equal(parseRemote('https://gitlab.example.com:443/group/app.git').webUrl, 'https://gitlab.example.com/group/app');
});

test('detectHost reads the work repo origin with insteadOf applied; git.host overrides it', (t) => {
  const fx = makeInPlace(t);
  assert.equal(detectHost({ workTree: fx.app, config: {} }).kind, 'none');
  assert.throws(() => requireHost(detectHost({ workTree: fx.app, config: {} }), { workTree: fx.app, taskId: 'x' }), (error) => error.exitCode === 3 && /no PR\/MR host/.test(error.message) && /--skipped/.test(error.fix));

  gitIn(fx.root, fx.env)('remote', 'set-url', 'origin', 'git@gitlab.example.com:outer/project.git');
  const app = gitIn(fx.app, fx.env);
  app('remote', 'set-url', 'origin', 'git@github.com:acme/app.git');
  // The pushurl points pushes at the bare repo; detection reads the fetch URL.
  app('config', 'remote.origin.pushurl', fx.remote);
  const host = detectHost({ workTree: fx.app, config: {} });
  assert.deepEqual({ kind: host.kind, source: host.source, repo: host.repo, cli: host.cli }, { kind: 'github', source: 'origin', repo: 'acme/app', cli: 'gh' });

  const forced = detectHost({ workTree: fx.app, config: { git: { host: 'gitlab' } } });
  assert.deepEqual([forced.kind, forced.source, forced.cli], ['gitlab', 'config', 'glab']);

  // An insteadOf shorthand names the host it expands to.
  app('remote', 'set-url', 'origin', 'gh:acme/app');
  app('config', 'url.git@github.com:.insteadOf', 'gh:');
  const short = detectHost({ workTree: fx.app, config: {} });
  assert.deepEqual([short.kind, short.hostname, short.repo, short.webUrl], ['github', 'github.com', 'acme/app', 'https://github.com/acme/app']);

  app('remote', 'set-url', 'origin', 'https://oauth2:tok3n-value@git.example.org/team/app.git');
  const other = detectHost({ workTree: fx.app, config: {} });
  assert.equal(other.kind, 'gitlab');
  assert.equal(other.remoteUrl, 'https://git.example.org/team/app.git');
});

test('quote survives sh; the push command never sets an upstream', () => {
  for (const text of ["[FEATURE] Don't break it", 'plain/path-1.md', 'a "b" $c `d`']) {
    const result = spawnSync('sh', ['-c', `printf '%s' ${quote(text)}`], { encoding: 'utf8' });
    assert.equal(result.stdout, text);
  }
  assert.equal(quote('NO-TICKET/feature/x'), 'NO-TICKET/feature/x');
  assert.equal(pushCommand({ git: 'git -C app', branch: 'NO-TICKET/feature/x' }), 'git -C app push origin NO-TICKET/feature/x');
  assert.equal(pushCommand({ git: "git -C '/w/my tree'", branch: "a'b" }), "git -C '/w/my tree' push origin 'a'\\''b'");
});

test('github: an open, a merged and no PR; login and install problems are exit 3', () => {
  const find = (stub, which = installed) => github.findExisting({ host: GITHUB, branch: 'b', cwd: '/', env: {}, run: stub.run, which });
  let stub = runner({ stdout: JSON.stringify({ url: 'https://github.com/acme/app/pull/7', state: 'OPEN' }) });
  assert.deepEqual(find(stub), { url: 'https://github.com/acme/app/pull/7', state: 'OPEN', open: true });
  assert.deepEqual(stub.calls[0], ['gh', 'pr', 'view', 'b', '--repo', 'github.com/acme/app', '--json', 'url,state']);

  assert.equal(find(runner({ stdout: '{"url":"https://github.com/acme/app/pull/6","state":"MERGED"}' })).open, false);
  assert.equal(find(runner({ code: 1, stderr: 'no pull requests found for branch "b"\n' })), null);
  assert.throws(() => find(runner({ code: 4, stderr: 'To get started with GitHub CLI, please run: gh auth login' })), (error) => error.exitCode === 3 && error.fix.includes('gh auth login --hostname github.com'));
  assert.throws(() => find(runner({ code: 1, stderr: 'HTTP 502\nmore' })), (error) => exitCode(3)(error) && /HTTP 502/.test(error.message));
  assert.throws(() => find(runner(), missing), (error) => /gh is not installed/.test(error.message) && error.fix.startsWith('brew install gh'));
  assert.throws(() => find(runner({ code: 127, error: { code: 'ENOENT' } })), /gh is not installed/);

  const command = github.createCommand({ host: GITHUB, base: 'main', branch: 'NO-TICKET/feature/x', title: "[FEATURE] Don't break it", bodyFile: '/s/pr-body.md' });
  assert.equal(command, "gh pr create --repo github.com/acme/app -B main -H NO-TICKET/feature/x -t '[FEATURE] Don'\\''t break it' -F /s/pr-body.md");
});

test('gitlab: view first, then the list; JSON decides, both failing is exit 3', () => {
  const find = (stub, which = installed) => gitlab.findExisting({ host: GITLAB, branch: 'b', cwd: '/', env: {}, run: stub.run, which });
  let stub = runner({ stdout: JSON.stringify({ web_url: 'https://gitlab.example.com/group/sub/app/-/merge_requests/3', state: 'opened' }) });
  assert.deepEqual(find(stub), { url: 'https://gitlab.example.com/group/sub/app/-/merge_requests/3', state: 'opened', open: true });
  assert.deepEqual(stub.calls, [['glab', 'mr', 'view', 'b', '-R', GITLAB.webUrl, '-F', 'json']]);

  stub = runner({ code: 1, stderr: 'no open merge request available for "b"' }, { stdout: '[]' });
  assert.equal(find(stub), null);
  assert.deepEqual(stub.calls[1], ['glab', 'mr', 'list', '--source-branch', 'b', '--all', '-R', GITLAB.webUrl, '-F', 'json']);

  const merged = find(runner({ code: 1 }, { stdout: JSON.stringify([{ web_url: 'https://x/-/merge_requests/1', state: 'merged' }]) }));
  assert.deepEqual(merged, { url: 'https://x/-/merge_requests/1', state: 'merged', open: false });
  const preferOpen = find(runner({ code: 1 }, { stdout: JSON.stringify([{ web_url: 'https://x/1', state: 'merged' }, { web_url: 'https://x/2', state: 'opened' }]) }));
  assert.equal(preferOpen.url, 'https://x/2');
  assert.throws(() => find(runner({ code: 1, stderr: 'boom' }, { code: 1, stderr: '401 Unauthorized' })), (error) => exitCode(3)(error) && /401/.test(error.message) && error.fix.includes('glab auth login --hostname gitlab.example.com'));
  // git.host sets only the kind, so for an ssh host alias the fix is the PR/MR by hand, not git.host.
  assert.throws(() => find(runner({ code: 1 }, { code: 1 })), (error) => /If gitlab\.example\.com is an ssh host alias \(~\/\.ssh\/config\), cw cannot tell the real host: ask the user to push and open the merge request by hand, then run cw pr record --task <id> --url <url>\./.test(error.fix)
    && /If gitlab\.example\.com is a GitHub server, set git\.host to github/.test(error.fix)
    && !/is not a GitLab, set git\.host/.test(error.fix));
  assert.throws(() => find(runner(), missing), (error) => /glab is not installed/.test(error.message) && error.fix.startsWith('brew install glab'));

  const command = gitlab.createCommand({ host: GITLAB, base: 'main', branch: 'ABC-1/feature/x-y', title: '[FEATURE] Add x', bodyFile: '/s/pr-body.md' });
  assert.equal(command, "glab mr create -R https://gitlab.example.com/group/sub/app -s ABC-1/feature/x-y -b main -t '[FEATURE] Add x' --description-file /s/pr-body.md -y");
  assert.ok(!command.includes('--remove-source-branch') && !command.includes('--draft'));
});
