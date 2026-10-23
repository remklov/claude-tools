import assert from 'node:assert/strict';
import { test } from 'node:test';

import { commandName, parseShell } from '../../hooks/lib/shell.mjs';

const argvs = (text) => parseShell(text).map((command) => command.argv);

test('commands split on && || ; | |& & and newlines outside quotes', () => {
  assert.deepEqual(argvs('a 1 && b || c ; d | e |& f & g\nh'), [['a', '1'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g'], ['h']]);
  assert.deepEqual(argvs('echo "a && b; c | d" \'e || f\''), [['echo', 'a && b; c | d', 'e || f']]);
  assert.deepEqual(argvs('(cd app && git status)'), [['cd', 'app'], ['git', 'status']]);
  assert.deepEqual(argvs('for f in a b; do git status; done'), [['for', 'f', 'in', 'a', 'b'], ['git', 'status']]);
  assert.deepEqual(argvs('if true; then { git status; }; fi'), [['true'], ['git', 'status']]);
});

test('quotes, escapes, ANSI-C strings and line continuations make one word', () => {
  assert.deepEqual(argvs('g"i"t pu\\sh'), [['git', 'push']]);
  assert.deepEqual(argvs("echo $'git\\x20push' $'a\\'b'"), [['echo', 'git push', "a'b"]]);
  assert.deepEqual(argvs('git \\\n  push'), [['git', 'push']]);
  assert.deepEqual(argvs('echo "a \\"b\\" \\$c"'), [['echo', 'a "b" $c']]);
  assert.deepEqual(argvs('# git push\necho ok # git push'), [['echo', 'ok']]);
  assert.deepEqual(argvs('echo a#b'), [['echo', 'a#b']]);
});

test('$(…) and backticks are parsed recursively, also inside double quotes, before their command', () => {
  assert.deepEqual(argvs('echo $(git push)'), [['git', 'push'], ['echo', '$(git push)']]);
  assert.deepEqual(argvs('echo "x $(git push) y"'), [['git', 'push'], ['echo', 'x $(git push) y']]);
  assert.deepEqual(argvs('echo `git push`'), [['git', 'push'], ['echo', '`git push`']]);
  assert.deepEqual(argvs('echo "`git push`"'), [['git', 'push'], ['echo', '`git push`']]);
  assert.deepEqual(argvs('echo "$(echo "$(git push)")"'), [['git', 'push'], ['echo', '$(git push)'], ['echo', '$(echo "$(git push)")']]);
  assert.deepEqual(argvs('diff <(git show a) b'), [['git', 'show', 'a'], ['diff', '<(git show a)', 'b']]);
  assert.deepEqual(argvs("echo '$(git push)'"), [['echo', '$(git push)']], 'single quotes run nothing');
  assert.deepEqual(argvs('echo $((1 + 2)) ${HOME} $HOME'), [['echo', '$((1 + 2))', '${HOME}', '$HOME']]);
});

test('bash -c, sh -c, eval and a shell reading a heredoc or here-string run their script', () => {
  assert.deepEqual(argvs("bash -c 'git push'"), [['bash', '-c', 'git push'], ['git', 'push']]);
  assert.deepEqual(argvs('sh -lc "cd app && git push"'), [['sh', '-lc', 'cd app && git push'], ['cd', 'app'], ['git', 'push']]);
  assert.deepEqual(argvs("bash -o pipefail -ec 'git push'").at(-1), ['git', 'push']);
  assert.deepEqual(argvs('eval "git push"').at(-1), ['git', 'push']);
  assert.deepEqual(argvs('bash <<EOF\ngit push\nEOF').at(-1), ['git', 'push']);
  assert.deepEqual(argvs("bash <<< 'git push'").at(-1), ['git', 'push']);
  assert.deepEqual(argvs('bash script.sh'), [['bash', 'script.sh']], 'a script file is not read');
});

test('heredoc bodies are data unless a shell reads them', () => {
  const spec = "cw spec save --task x <<'EOF'\n## Run git push --force\n$(git push)\nEOF\necho done";
  assert.deepEqual(argvs(spec), [['cw', 'spec', 'save', '--task', 'x'], ['echo', 'done']]);
  assert.equal(parseShell(spec)[0].heredocs[0].body, '## Run git push --force\n$(git push)\n');
  const message = "git commit -m \"$(cat <<'EOF'\nFix (one\ngit push --force\nEOF\n)\" && git status";
  assert.deepEqual(argvs(message).map((argv) => argv[0] === 'git' ? argv.slice(0, 2) : argv), [['cat'], ['git', 'commit'], ['git', 'status']]);
  assert.deepEqual(argvs('cat <<-EOF\n\tgit push\n\tEOF\necho ok'), [['cat'], ['echo', 'ok']]);
});

test('an unquoted heredoc body expands $(…), backticks and ${…} like double quotes; a quoted one does not', () => {
  assert.deepEqual(argvs('cat <<EOF\nrun $(git push origin x) now\nEOF\necho done'), [['git', 'push', 'origin', 'x'], ['cat'], ['echo', 'done']]);
  assert.deepEqual(argvs('cat <<EOF | sh\n`git push`\nEOF'), [['git', 'push'], ['cat'], ['sh']]);
  assert.deepEqual(argvs('cat <<EOF\n${X:-$(git push)} and \\$(not run) and \\`not run\\`\nEOF'), [['git', 'push'], ['cat']]);
  assert.deepEqual(argvs('cat <<EOF\ndon\'t "quote" $HOME ${HOME} $((1 + 2))\nEOF'), [['cat']], 'quotes are text there');
  assert.deepEqual(argvs("cat <<'EOF'\n$(git push)\nEOF"), [['cat']]);
  assert.deepEqual(argvs('cat <<"EOF"\n`git push`\nEOF'), [['cat']]);
  assert.deepEqual(argvs('git commit -F- <<EOF\n$(cat <<INNER\n$(git push)\nINNER\n)\nEOF').map((argv) => argv[0]), ['git', 'cat', 'git']);
});

test('${…} parses the command substitutions in its word, also nested', () => {
  assert.deepEqual(argvs('echo ${X:-$(git push origin x)}'), [['git', 'push', 'origin', 'x'], ['echo', '${X:-$(git push origin x)}']]);
  assert.deepEqual(argvs('echo "${X:-${Y:-`git push`}}" next'), [['git', 'push'], ['echo', '${X:-${Y:-`git push`}}', 'next']]);
  assert.deepEqual(argvs('echo ${X#*\\}} ${#ARR[@]} ${X/a/b}'), [['echo', '${X#*\\}}', '${#ARR[@]}', '${X/a/b}']]);
  assert.deepEqual(argvs('echo ${X:-$(echo })}'), [['echo', '}'], ['echo', '${X:-$(echo })}']]);
});

test('the wrappers env, command, exec, nohup, timeout, sudo, time, nice and xargs are stripped', () => {
  for (const text of [
    'env FOO=1 -u BAR git push',
    'command git push',
    'exec -a name git push',
    'nohup git push',
    'timeout -s KILL 30 git push',
    'sudo -u root -E git push',
    'nice -n 10 git push',
    'time git push',
    '/usr/bin/time -p git push',
    'xargs -I {} git push',
    'timeout 5 nohup sudo env A=1 command git push',
    'env -S "git push"',
  ]) {
    assert.deepEqual(argvs(text), [['git', 'push']], text);
  }
  assert.deepEqual(parseShell('env FOO=1 git push')[0].assignments, ['FOO=1']);
  assert.deepEqual(parseShell('timeout 5 nohup git push')[0].wrappers, ['timeout', 'nohup']);
});

test('a path to a program is read as the program; assignments in front are kept apart', () => {
  assert.deepEqual(argvs('/usr/bin/git push && ./node_modules/.bin/vite'), [['git', 'push'], ['vite']]);
  assert.equal(commandName('/opt/homebrew/bin/npm'), 'npm');
  const [command] = parseShell('PORT=3000 FOO="a b" npm run dev');
  assert.deepEqual([command.assignments, command.argv], [['PORT=3000', 'FOO=a b'], ['npm', 'run', 'dev']]);
  assert.deepEqual(argvs('"A=1" git'), [['A=1', 'git']], 'a quoted name is no assignment');
});

test('redirections name their targets and whether they write', () => {
  const [echo, cat] = parseShell('echo hi > out.txt 2>&1 >>"log file"; cat < in 2>/dev/null &> all.log <> rw');
  assert.deepEqual(echo.argv, ['echo', 'hi']);
  assert.deepEqual(echo.redirects.map((r) => [r.op, r.fd, r.target, r.write]), [['>', null, 'out.txt', true], ['>&', 2, '1', false], ['>>', null, 'log file', true]]);
  assert.deepEqual(cat.redirects.map((r) => [r.op, r.target, r.write]), [['<', 'in', false], ['>', '/dev/null', true], ['&>', 'all.log', true], ['<>', 'rw', true]]);
  assert.deepEqual(parseShell('echo a>b')[0].argv, ['echo', 'a']);
  assert.deepEqual(parseShell('echo x >& file')[0].redirects[0].write, true);
  assert.deepEqual(parseShell('echo x >| file')[0].redirects[0].write, true);
});

test('broken input does not throw', () => {
  for (const text of ['echo "unterminated', "echo 'open", 'echo $(git push', 'echo `git', 'cat <<EOF\nno end', ')))((', '', null, '>', '|| &&']) {
    assert.doesNotThrow(() => parseShell(text), String(text));
  }
  assert.deepEqual(argvs('echo $(git push'), [['git', 'push'], ['echo', '$(git push']]);
});
