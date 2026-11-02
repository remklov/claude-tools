// Every guard of §9 with positive cases, negative cases and the bypass forms of the parser rules:
// && || ; | and newlines, $(…) and backticks (also inside double quotes), bash -c / sh -c, the
// wrappers env, command, exec, nohup, timeout, sudo, and /usr/bin/git.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { canonical } from '../../hooks/lib/context.mjs';
import { evaluate, gitWrites, isDevServer, matchesCommand } from '../../hooks/lib/guards.mjs';
import { pluginRoot, tempBase, write } from '../fixtures/repo.mjs';

const IMPLEMENTER = { agent_id: 'a1', agent_type: 'dev-workflow:implementer-m' };
const REVIEWER = { agent_id: 'a2', agent_type: 'dev-workflow:reviewer' };
const EXPLORE = { agent_id: 'a3', agent_type: 'Explore' };
const MAIN = {};
// The node-npm pack's own list, so a missing npm alias fails here.
const NODE_NPM = JSON.parse(readFileSync(join(pluginRoot, 'packs', 'node-npm', 'pack.json'), 'utf8')).guards.dependencyCommands;

// A project directory with the fields evaluate reads; state.json lists the tasks for G-ORCH-EDIT.
function project(t, { mode = 'in-place', guards = {}, packGuards = {}, tasks = [] } = {}) {
  const base = tempBase(t);
  mkdirSync(join(base, 'project', 'app', 'src'), { recursive: true });
  const root = canonical(join(base, 'project'));
  write(root, { '.git/dev-workflow/state.json': { version: 1, tasks } });
  const ws = {
    cwd: root,
    configRoot: root,
    workRepo: mode === 'in-place' ? join(root, 'app') : root,
    commonDir: join(root, '.git'),
    stateDir: join(root, '.git', 'dev-workflow'),
    mode,
    config: { guards: { ports: [], commands: [], devServer: 'allowed', ...guards } },
  };
  const all = { dependencyCommands: NODE_NPM, commands: [], ports: [], ...packGuards };
  const check = (who, tool, toolInput, extra = {}) =>
    evaluate({ input: { session_id: 's1', cwd: root, ...who, tool_name: tool, tool_input: toolInput, ...extra }, ws, guards: all });
  const bash = (who, command) => check(who, 'Bash', { command })?.id ?? null;
  return { root, ws, check, bash };
}

// The forms §9 says the guard sees through, for a command without quotes.
const bypasses = (command) => [
  `true && ${command}`,
  `false || ${command}`,
  `true; ${command}`,
  `echo x | ${command}`,
  `echo start\n${command}`,
  `echo $(${command})`,
  `echo "result: $(${command})"`,
  `echo \`${command}\``,
  `echo "result: \`${command}\`"`,
  `bash -c '${command}'`,
  `sh -c "${command}"`,
  `cat <<EOF\n$(${command})\nEOF`,
  `cat <<-EOF | head -1\n\t\`${command}\`\n\tEOF`,
  `echo \${X:-$(${command})}`,
  `echo "\${X:-\${Y:-$(${command})}}"`,
  `env FOO=1 ${command}`,
  `command ${command}`,
  `exec ${command}`,
  `nohup ${command} &`,
  `timeout 30 ${command}`,
  `sudo ${command}`,
  ...(command.startsWith('git ') ? [`/usr/bin/${command}`, `env /usr/bin/${command}`] : []),
];

function assertDenied(bash, who, id, commands) {
  for (const command of commands) assert.equal(bash(who, command), id, `${id} for ${JSON.stringify(command)}`);
}
function assertAllowed(bash, who, commands) {
  for (const command of commands) assert.equal(bash(who, command), null, `allowed: ${JSON.stringify(command)}`);
}

test('G-FORCE denies a force push to everyone, also behind every bypass form', (t) => {
  const { bash } = project(t);
  const forced = ['git push --force', 'git push -f origin feature', 'git push --force-with-lease', 'git push --force-with-lease=main:abc origin main', 'git push origin +main', 'git push -fu origin x', 'git -C app push --force origin x'];
  for (const who of [MAIN, IMPLEMENTER, REVIEWER, EXPLORE]) assertDenied(bash, who, 'G-FORCE', forced);
  assertDenied(bash, MAIN, 'G-FORCE', bypasses('git push --force origin feature'));
  assertAllowed(bash, MAIN, [
    'git push origin feature',
    'git -C app push origin NO-TICKET/feature/x',
    'git pull --force',
    'echo "git push --force"',
    "cw spec save --task x <<'EOF'\nNever git push --force.\n$(git push --force)\nEOF",
    'cw spec save --task x <<EOF\nNever git push --force.\nEOF',
    'git push --no-force-with-lease origin x',
  ]);
});

test('G-PUSH denies push and PR/MR commands to workflow subagents only', (t) => {
  const { bash } = project(t);
  const delivery = ['git push origin feature', 'git -C app push', 'gh pr create -t x -F body.md', 'gh pr new', 'gh pr merge 12', 'glab mr create -s a -b main -y', 'glab mr new', 'glab -R group/app mr merge 3', 'glab mr accept 3', 'glab mr for 7'];
  for (const who of [IMPLEMENTER, REVIEWER]) assertDenied(bash, who, 'G-PUSH', delivery);
  assertDenied(bash, IMPLEMENTER, 'G-PUSH', bypasses('git push origin feature'));
  assertDenied(bash, REVIEWER, 'G-PUSH', bypasses('gh pr create -t x'));
  assertAllowed(bash, MAIN, delivery);
  assertAllowed(bash, EXPLORE, ['git push origin feature']);
  assertAllowed(bash, IMPLEMENTER, ['gh pr view 12', 'glab mr view 3', 'git status', 'echo git push', 'cw pr command --task x']);
});

test('G-REVIEWER-WRITE keeps the reviewer read-only inside the project; a cp source is no write', (t) => {
  const { bash } = project(t);
  const writes = [
    'git commit -m x',
    'git -C app add .',
    'git checkout main',
    'git switch -c x',
    'git reset --hard',
    'git stash',
    'git branch new-one',
    'git branch -D old',
    'git tag v1',
    'git tag -d v1',
    'git worktree add /tmp/x',
    'git apply fix.diff',
    'git rebase main',
    'echo x > app/src/a.mjs',
    'echo x >> README.md',
    'echo x &> app/out.log',
    'cat a | tee app/x.txt',
    "sed -i 's/a/b/' app/src/a.mjs",
    "sed -i '' 's/a/b/' app/src/a.mjs",
    "sed -E -i.bak -e 's/a/b/' app/src/a.mjs",
    "perl -pi -e 's/a/b/' app/src/a.mjs",
    'cp /tmp/x app/src/a.mjs',
    'cp -t app/src /tmp/x',
    'mv app/a.mjs app/b.mjs',
    'rm app/src/a.mjs',
    'touch app/new.txt',
    'mkdir app/tmp',
    'echo x > $PWD/a.txt',
    '(cd app && echo x > a.txt)',
    'dd if=/dev/zero of=app/blob bs=1 count=1',
    // git writes of .git/config and files, and find removing or changing the files it finds.
    'git config core.hooksPath x',
    'git config --global user.name "X Y"',
    'git config --unset core.hooksPath',
    'git config set core.hooksPath x',
    'git remote add x https://example.com/x.git',
    'git remote remove origin',
    'git remote rename origin up',
    'git remote set-url origin x',
    'git diff --output=app/x.diff',
    'git diff --output app/x.diff',
    'git format-patch -o app/patches main',
    'find app -name x -delete',
    'find app/src -name "*.mjs" -exec rm {} \\;',
    "find . -name '*.mjs' -exec sed -i 's/a/b/' {} +",
    'find app -fprint app/list.txt',
  ];
  assertDenied(bash, REVIEWER, 'G-REVIEWER-WRITE', writes);
  assertDenied(bash, REVIEWER, 'G-REVIEWER-WRITE', bypasses('git commit -m x'));
  assertDenied(bash, REVIEWER, 'G-REVIEWER-WRITE', bypasses('touch app/new.txt'));
  assertAllowed(bash, REVIEWER, [
    'git status',
    'git -C app log --oneline -5',
    'git diff main...HEAD',
    'git show HEAD:src/a.mjs',
    'git branch',
    'git branch -a',
    'git branch --show-current',
    'git branch --contains abc123',
    'git stash list',
    'git worktree list',
    'git tag',
    "git tag -l 'v*'",
    'git apply --check fix.diff',
    'echo x > /tmp/out.txt',
    'npm test 2>/dev/null',
    'npm test 2>&1 | tail -5',
    'cp app/src/a.mjs /tmp/a.mjs',
    'cp -r app/src /tmp/copy',
    "sed -n 's/a/b/p' app/src/a.mjs",
    "perl -Mstrict -Ilib -ne 'print' app/src/a.mjs",
    'tee /tmp/x < app/src/a.mjs',
    'echo x > "$TMPDIR/x"',
    'cw review save --task x < /tmp/review.json',
    'git config user.name',
    'git config --get core.hooksPath',
    'git config --get-regexp remote\\..*',
    'git config --file .gitmodules submodule.x.url',
    'git config list',
    'git remote -v',
    'git remote get-url origin',
    'git remote show origin',
    'git diff --output=/tmp/x.diff',
    'git log --stat',
    'find app -name "*.mjs"',
    'find app -name x -exec cat {} \\;',
    'find app -name x -exec cp {} /tmp/ \\;',
    'find /tmp/scratch -delete',
  ]);
  assertAllowed(bash, IMPLEMENTER, ['git commit -m x', 'echo x > app/src/a.mjs', "sed -i 's/a/b/' app/src/a.mjs"]);
  assertAllowed(bash, MAIN, ['git commit -m x', 'rm app/src/a.mjs']);
});

test('G-DEPS denies the packs dependency commands to workflow subagents', (t) => {
  const { bash } = project(t);
  const installs = ['npm install lodash', 'npm i -D vitest', 'npm ci', 'npm -w app install x', 'npm install --workspace=app x', 'npm audit fix', 'npm uninstall x', 'npm update', '/usr/local/bin/npm install', 'npx npm install x'];
  // npm's aliases (npm <command> --help, npm 11.6.2) change the dependencies just the same.
  const aliases = ['npm add lodash', 'npm isntall x', 'npm in x', 'npm clean-install', 'npm ic', 'npm rm x', 'npm r x', 'npm un x', 'npm remove x', 'npm unlink x', 'npm up', 'npm upgrade x', 'npm it', 'npm install-test', 'npm cit', 'npm install-ci-test', 'npm sit'];
  for (const who of [IMPLEMENTER, REVIEWER]) assertDenied(bash, who, 'G-DEPS', aliases);
  assertDenied(bash, IMPLEMENTER, 'G-DEPS', bypasses('npm add lodash'));
  for (const who of [IMPLEMENTER, REVIEWER]) assertDenied(bash, who, 'G-DEPS', installs);
  assertDenied(bash, IMPLEMENTER, 'G-DEPS', bypasses('npm install lodash'));
  assertAllowed(bash, IMPLEMENTER, ['npm test', 'npm run ci', 'npm audit', 'npm run build -- --install', 'npm ls', 'echo npm install', 'npm run rm', 'npm run add-route']);
  assertAllowed(bash, MAIN, installs);
  assertAllowed(bash, EXPLORE, installs);
});

test('G-COMMANDS denies the config and pack command lists to workflow subagents', (t) => {
  const { bash } = project(t, { guards: { commands: ['docker compose', 'drizzle-kit push'] }, packGuards: { commands: ['prisma migrate'] } });
  assertDenied(bash, IMPLEMENTER, 'G-COMMANDS', ['docker compose up -d', 'npx drizzle-kit push', 'pnpm exec drizzle-kit push', 'prisma migrate dev']);
  assertDenied(bash, REVIEWER, 'G-COMMANDS', bypasses('docker compose up'));
  assertAllowed(bash, IMPLEMENTER, ['docker ps', 'drizzle-kit generate', 'prisma generate']);
  assertAllowed(bash, MAIN, ['docker compose up -d']);
});

test('G-PORTS denies the reserved ports to workflow subagents', (t) => {
  const { bash } = project(t, { guards: { ports: [5173] }, packGuards: { ports: [5432] } });
  assertDenied(bash, IMPLEMENTER, 'G-PORTS', [
    'curl http://localhost:5173/',
    'vite --port 5173',
    'npx vite --port=5173',
    'PORT=5173 node server.js',
    'lsof -i :5432',
    'psql -p 5432',
    'psql -p5432',
    'kill $(lsof -t -i:5173)',
  ]);
  assertDenied(bash, IMPLEMENTER, 'G-PORTS', bypasses('curl localhost:5173'));
  assertAllowed(bash, IMPLEMENTER, ['curl localhost:51730', 'sleep 5173', 'head -n 5173 x', 'echo 5432']);
  // A port that is only mentioned in text: read, searched, printed or recorded, never bound or contacted.
  assertAllowed(bash, IMPLEMENTER, [
    'grep -rn "localhost:5173" app/src',
    'rg -n localhost:5432 app',
    'cat app/.env | grep :5173',
    "sed -n '/localhost:5173/p' app/vite.config.ts",
    'echo "see http://localhost:5173/"',
    "printf '%s\\n' localhost:5173",
    'cw commit msg --task T --keyword BUGFIX --summary "Allow CORS from localhost:5173"',
    'git commit -m "Allow CORS from localhost:5173"',
    'git log --grep localhost:5173',
  ]);
  assertDenied(bash, IMPLEMENTER, 'G-PORTS', ['git clone http://localhost:5173/x.git', 'git fetch http://127.0.0.1:5432/repo', 'grep x $(curl -s localhost:5173)']);
  assertAllowed(bash, MAIN, ['curl http://localhost:5173/']);
});

test('G-DEVSERVER denies dev servers to workflow subagents when guards.devServer is never', (t) => {
  const never = project(t, { guards: { devServer: 'never' } });
  const servers = [
    'npm run dev', 'npm start', 'npm run dev -w app', 'npm -w app run dev:server', 'pnpm dev', 'yarn start', 'npx vite', 'vite', 'next dev', 'node --watch server.js', 'nohup npm run dev &',
    // An option value is not the subcommand; a path is vite's project root.
    'npx vite --config vite.config.ts', 'vite -c vite.config.ts', 'vite --mode staging', 'vite --port 5180 --host 0.0.0.0', 'vite app/', 'npx vite --base /x/ serve', 'next -p 3001 dev',
  ];
  assertDenied(never.bash, IMPLEMENTER, 'G-DEVSERVER', servers);
  assertDenied(never.bash, REVIEWER, 'G-DEVSERVER', bypasses('npm run dev'));
  assertAllowed(never.bash, IMPLEMENTER, ['npm run build', 'npx vite build', 'npm test', 'npm run devtools', 'node server.test.mjs', 'npx vite build --config vite.config.ts', 'vite --mode production build', 'vite optimize -c x.ts']);
  assertAllowed(never.bash, MAIN, servers);
  const allowed = project(t);
  assertAllowed(allowed.bash, IMPLEMENTER, servers);
});

test('G-AGENT-PARAMS denies model/effort for everyone and, in worktree mode, an implementer without isolation', (t) => {
  const inPlace = project(t);
  const call = (overrides) => ({ subagent_type: 'dev-workflow:implementer-s', description: 'x', prompt: 'y', run_in_background: false, ...overrides });
  for (const who of [MAIN, IMPLEMENTER, EXPLORE]) {
    assert.equal(inPlace.check(who, 'Agent', call({ model: 'opus' }))?.id, 'G-AGENT-PARAMS');
    assert.equal(inPlace.check(who, 'Agent', call({ effort: 'high' }))?.id, 'G-AGENT-PARAMS');
  }
  assert.match(inPlace.check(MAIN, 'Agent', call({ model: 'opus', effort: 'max' })).reason, /model and effort are fixed per agent/);
  assert.equal(inPlace.check(MAIN, 'Agent', call({})), null);
  assert.equal(inPlace.check(MAIN, 'Agent', call({ model: null })), null);
  assert.equal(inPlace.check(MAIN, 'Agent', { subagent_type: 'Explore', prompt: 'find x' }), null);

  const worktree = project(t, { mode: 'worktree' });
  assert.equal(worktree.check(MAIN, 'Agent', call({}))?.id, 'G-AGENT-PARAMS');
  assert.equal(worktree.check(MAIN, 'Agent', call({ subagent_type: 'implementer-xl' }))?.id, 'G-AGENT-PARAMS');
  assert.match(worktree.check(MAIN, 'Agent', call({ isolation: 'none' })).reason, /isolation: "worktree"/);
  assert.equal(worktree.check(MAIN, 'Agent', call({ isolation: 'worktree' })), null);
  assert.equal(worktree.check(MAIN, 'Agent', call({ subagent_type: 'dev-workflow:reviewer' })), null);
});

test('G-CD denies a cd that stays to the orchestrating session and the workflow agents; a subshell cd passes', (t) => {
  const tasks = [{ id: 'NO-TICKET__feature__mul', phase: 'implement', outcome: null, ownerSession: 's1' }];
  const { bash, check } = project(t, { tasks });
  const staying = ['cd app', 'cd app && git status', 'cd /tmp; ls', 'pushd app', 'cd /dev/null 2>/dev/null; for f in a b; do cat $f; done', 'true && cd app'];
  for (const who of [MAIN, IMPLEMENTER, REVIEWER]) assertDenied(bash, who, 'G-CD', staying);
  assertAllowed(bash, IMPLEMENTER, ['(cd app && npm test)', 'echo $(cd app && pwd)', "bash -c 'cd app && ls'", 'git -C app status']);
  assertAllowed(bash, EXPLORE, ['cd app && ls']);
  assert.equal(check(MAIN, 'Bash', { command: 'cd app' }, { session_id: 's2' }), null, 'a session without a task changes its directory freely');
  assert.match(check(IMPLEMENTER, 'Bash', { command: 'cd app' }).reason, /subshell: \(cd <dir> && <command>\)/);
  assert.match(check(MAIN, 'Bash', { command: 'cd app' }).reason, /orchestrator never changes the directory/);
});

test('G-REVIEWER-WRITE lets the reviewer write only its file outside the project', (t) => {
  const { root, check } = project(t);
  const outside = join(tempBase(t), 'scratchpad', 'NO-TICKET__feature__mul-review-1.json');
  const refused = [
    ['Edit', { file_path: join(root, 'app', 'src', 'a.mjs') }],
    ['Write', { file_path: join(root, 'app', 'src', 'a.mjs') }],
    ['Write', { file_path: 'review.json' }],
    ['NotebookEdit', { notebook_path: join(root, 'x.ipynb') }],
    ['Edit', { file_path: outside }],
  ];
  for (const [tool, toolInput] of refused) assert.equal(check(REVIEWER, tool, toolInput)?.id, 'G-REVIEWER-WRITE', `${tool} ${JSON.stringify(toolInput)}`);
  assert.equal(check(REVIEWER, 'Write', { file_path: outside }), null, 'the review file in the scratchpad');
});

test('G-ORCH-EDIT denies project edits in the main session that owns an active task', (t) => {
  const tasks = [
    { id: 'NO-TICKET__feature__mul', phase: 'implement', outcome: null, ownerSession: 's1' },
    { id: 'NO-TICKET__feature__old', phase: 'done', outcome: 'done', ownerSession: 's9' },
  ];
  const { root, check } = project(t, { tasks });
  const file = join(root, 'app', 'src', 'a.mjs');
  const denied = check(MAIN, 'Edit', { file_path: file });
  assert.equal(denied?.id, 'G-ORCH-EDIT');
  assert.match(denied.reason, /orchestrates task NO-TICKET__feature__mul \(phase implement\).*cw task end --task NO-TICKET__feature__mul/);
  assert.equal(check(MAIN, 'Write', { file_path: join(root, '.claude', 'dev-workflow', 'config.json') })?.id, 'G-ORCH-EDIT');
  assert.equal(check(MAIN, 'NotebookEdit', { notebook_path: join(root, 'app', 'x.ipynb') })?.id, 'G-ORCH-EDIT');
  assert.equal(check(MAIN, 'Edit', { file_path: 'app/src/a.mjs' })?.id, 'G-ORCH-EDIT', 'a relative path resolves from the cwd');
  assert.equal(check(MAIN, 'Edit', { file_path: join(root, 'app', 'src', '..', 'new.mjs') })?.id, 'G-ORCH-EDIT');
  // The edit tools take paths literally: a $ in a route file name is no shell expansion.
  for (const route of ['app/routes/$id.tsx', 'app/routes/posts.$postId.tsx', join(root, 'app', 'routes', '$.tsx'), 'app/`x`.mjs']) {
    assert.equal(check(MAIN, 'Edit', { file_path: route })?.id, 'G-ORCH-EDIT', route);
  }
  assert.equal(check(MAIN, 'Write', { file_path: join(tempBase(t), '$scratch.md') }), null, 'a $ file outside the project');

  assert.equal(check(IMPLEMENTER, 'Edit', { file_path: file }), null, 'the implementer edits');
  assert.equal(check(EXPLORE, 'Write', { file_path: file }), null);
  assert.equal(check(MAIN, 'Edit', { file_path: file }, { session_id: 's2' }), null, 'another session owns nothing');
  assert.equal(check(MAIN, 'Edit', { file_path: file }, { session_id: 's9' }), null, 'an ended task binds nothing');
  assert.equal(check(MAIN, 'Write', { file_path: join(tempBase(t), 'notes.md') }), null, 'files outside the project are not the task code');
  assert.equal(check(MAIN, 'Bash', { command: 'git status' }), null);
});

test('the command matchers', () => {
  assert.equal(matchesCommand(['npm', '--prefix', 'app', 'ci'], 'npm ci'), true);
  assert.equal(matchesCommand(['npm', 'run', 'ci'], 'npm ci'), false);
  assert.equal(matchesCommand(['bunx', 'drizzle-kit', 'push'], 'drizzle-kit push'), true);
  assert.equal(matchesCommand(['npm', 'exec', '--', 'drizzle-kit', 'push'], 'drizzle-kit push'), true);
  assert.equal(matchesCommand(['docker'], 'docker compose'), false);
  assert.equal(gitWrites({ sub: 'notes', args: [] }), false);
  assert.equal(gitWrites({ sub: 'notes', args: ['add', '-m', 'x'] }), true);
  assert.equal(gitWrites({ sub: 'log', args: [] }), false);
  assert.equal(isDevServer(['yarn', 'exec', 'vite']), true);
  assert.equal(isDevServer(['vite', 'optimize']), false);
});
