import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMessage, lintBranch, lintMessage, lintRange, normalizeFlags, normalizeKeyword, wrapText,
} from '../../cli/lib/commit.mjs';
import { loadPreset, withDefaults } from '../../cli/lib/config.mjs';
import { gitIn, inPlaceConfig, makeInPlace, write } from '../fixtures/repo.mjs';

// In-process lib calls spawn git with process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const preset = loadPreset('default');
const ticketOpts = { ticket: 'ABC-123', noTicket: false, noTicketKey: 'NO-TICKET' };
const noTicketOpts = { ticket: 'NO-TICKET', noTicket: true, noTicketKey: 'NO-TICKET' };
const errorsOf = (message, options = ticketOpts) => lintMessage(preset, message, options).filter((f) => f.level === 'error').map((f) => f.message);

test('keywords and flags accept bare, bracketed and lowercase forms; unknown ones are usage errors', () => {
  for (const value of ['feature', 'FEATURE', '[FEATURE]']) assert.equal(normalizeKeyword(preset, value), '[FEATURE]');
  assert.throws(() => normalizeKeyword(preset, 'FIX'), (error) => error.exitCode === 2 && /FEATURE, BUGFIX, TASK, DOCS/.test(error.fix));
  assert.deepEqual(normalizeFlags(preset, ['security', '[!!!]']), ['[!!!]', '[SECURITY]']);
  assert.throws(() => normalizeFlags(preset, ['BREAKING']), (error) => error.exitCode === 2);
});

test('buildMessage: flags without a space, wrapped body, Relates-to trailer except for the no-ticket key', () => {
  const body = `${'This explains why the endpoint exists and what the reviewer should look at closely '.repeat(2).trim()}\n\n- a list item that is longer than seventy-two characters stays on one line as it is\nSee https://example.com/a/very/long/url/that/must/never/be/wrapped/even/when/it/is/long`;
  const { message, warnings } = buildMessage(preset, { ...ticketOpts, summary: 'Add the version endpoint', keyword: '[FEATURE]', flags: ['[!!!]'], body });
  const lines = message.split('\n');
  assert.equal(lines[0], '[!!!][FEATURE] Add the version endpoint');
  assert.equal(lines[1], '');
  assert.ok(lines.slice(2, 4).every((line) => line.length <= 72), 'the paragraph is wrapped at 72');
  assert.ok(lines.some((line) => line.startsWith('- a list item') && line.length > 72), 'list items are not wrapped');
  assert.ok(lines.some((line) => line.startsWith('See https://') && line.length > 72), 'URLs are not wrapped');
  assert.ok(message.endsWith('\n\nRelates to ABC-123\n'));
  assert.deepEqual(warnings, []);
  assert.deepEqual(errorsOf(message), [], 'what buildMessage writes passes the lint');

  const plain = buildMessage(preset, { ...noTicketOpts, summary: 'Tidy the readme', keyword: '[DOCS]' });
  assert.equal(plain.message, '[DOCS] Tidy the readme\n');

  // Trailers go last, after the ticket trailer, and the lint accepts them there.
  const attributed = buildMessage(preset, { ...ticketOpts, summary: 'Add the version endpoint', keyword: '[FEATURE]', trailers: ['Co-Authored-By: Claude <noreply@anthropic.com>'] });
  assert.ok(attributed.message.endsWith('\n\nRelates to ABC-123\nCo-Authored-By: Claude <noreply@anthropic.com>\n'));
  assert.deepEqual(errorsOf(attributed.message), []);
  assert.equal(buildMessage(preset, { ...noTicketOpts, summary: 'Tidy the readme', keyword: '[DOCS]', trailers: ['Co-Authored-By: A <a@b>'] }).message, '[DOCS] Tidy the readme\n\nCo-Authored-By: A <a@b>\n');
});

test('buildMessage refuses bad summaries with exit 1 and warns above the ideal length', () => {
  const build = (summary) => buildMessage(preset, { ...ticketOpts, summary, keyword: '[TASK]' });
  assert.throws(() => build('x'.repeat(66)), (error) => error.exitCode === 1 && /73 characters \(max 72\)/.test(error.message));
  assert.equal(build('X'.repeat(65)).message.split('\n')[0].length, 72);
  assert.throws(() => build('add the thing'), (error) => error.exitCode === 1 && /capital letter/.test(error.message));
  assert.throws(() => build('[TASK] Add it'), (error) => error.exitCode === 1 && /starts with "\["/.test(error.message));
  assert.throws(() => build('  '), (error) => error.exitCode === 1 && /empty/.test(error.message));
  assert.match(build('Add a summary that is longer than the ideal length').warnings[0], /ideally ≤ 52/);
});

test('wrapText keeps fenced code, single tokens and indentation', () => {
  const code = `\`\`\`\n${'const x = 1; '.repeat(10)}\n\`\`\``;
  assert.equal(wrapText(code, 72), code);
  assert.equal(wrapText('x'.repeat(100), 72), 'x'.repeat(100));
  assert.deepEqual(wrapText(`  ${'word '.repeat(20).trim()}`, 30).split('\n').map((line) => line.startsWith('  ')), [true, true, true, true]);
});

test('wrapText and lintMessage leave lines indented by 4 spaces or a tab (code) alone', () => {
  const code = `    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);`;
  const tabbed = `\tconst total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);`;
  assert.ok(code.length > 72 && tabbed.length > 72);
  const body = `The total is computed like this:\n\n${code}\n${tabbed}`;
  assert.equal(wrapText(body, 72), body);
  assert.deepEqual(errorsOf(`[FEATURE] Add it\n\n${body}\n\nRelates to ABC-123`), []);
  assert.equal(buildMessage(preset, { ...ticketOpts, summary: 'Add it', keyword: '[FEATURE]', body }).message.split('\n').filter((line) => line === code).length, 1);
});

test('lintMessage: every rule has a failing and a passing case', () => {
  const ok = '[FEATURE] Add the version endpoint\n\nWhy it exists.\n\nRelates to ABC-123\n';
  assert.deepEqual(errorsOf(ok), []);
  assert.deepEqual(errorsOf('[!!!] [FEATURE] Add it\n\nRelates to ABC-123'), [], 'a space between flag and keyword is accepted');
  assert.deepEqual(errorsOf(`${ok}Co-Authored-By: Someone <a@b.c>\n`), [], 'attribution lines may follow the trailer');
  assert.deepEqual(errorsOf('[FEATURE] Add it\n\nRelates to ABC-1\nRelates to ABC-123\n'), [], 'one line per ticket');

  assert.match(errorsOf('feat: add it\n\nRelates to ABC-123')[0], /must start with one keyword/);
  assert.match(errorsOf('[FEATURE] add it\n\nRelates to ABC-123')[0], /capital letter/);
  assert.match(errorsOf(`[FEATURE] ${'A'.repeat(63)}\n\nRelates to ABC-123`)[0], /73 characters/);
  assert.match(errorsOf('fixup! [FEATURE] Add it\n\nRelates to ABC-123')[0], /fixup/);
  assert.match(errorsOf('[FEATURE] Add it\nRelates to ABC-123')[0], /second line must be blank/);
  assert.match(errorsOf(`[FEATURE] Add it\n\n${'word '.repeat(20)}\n\nRelates to ABC-123`)[0], /body line 3 is \d+ characters/);
  assert.deepEqual(errorsOf(`[FEATURE] Add it\n\n\`\`\`\n${'code '.repeat(20)}\n\`\`\`\n\nRelates to ABC-123`), [], 'code is exempt');
  assert.match(errorsOf('[FEATURE] Add it\n\nWhy.')[0], /must end with "Relates to ABC-123"/);
  assert.match(errorsOf('[FEATURE] Add it\n\nRelates to ABC-123\n\nMore text after it.')[0], /must end with/);
  assert.deepEqual(errorsOf('[TASK] Tidy up\n', noTicketOpts), []);
  assert.match(errorsOf('[TASK] Tidy up\n\nRelates to NO-TICKET\n', noTicketOpts)[0], /no-ticket key/);
  const advisory = lintMessage(preset, `[FEATURE] ${'A'.repeat(50)}\n\nRelates to ABC-123`, ticketOpts);
  assert.deepEqual(advisory.map((f) => f.level), ['advisory']);
});

test('lintBranch follows {ticket}/{type}/{slug} for the task ticket', () => {
  assert.deepEqual(lintBranch(preset, 'ABC-123/feature/version-endpoint', 'ABC-123'), []);
  for (const branch of ['ABC-123/chore/version-endpoint', 'ABC-123/feature/version', 'abc-123/feature/a-b', 'ABC-124/feature/a-b', 'ABC-123/feature/a-b-c-d-e']) {
    assert.equal(lintBranch(preset, branch, 'ABC-123').length, 1, branch);
  }
});

test('lintRange lints the task branch in its work tree: commits, merges, and zero commits', (t) => {
  const fx = makeInPlace(t, { config: inPlaceConfig({ git: { noTicketKey: 'NO-TICKET' } }) });
  const app = gitIn(fx.app, fx.env);
  const config = withDefaults(inPlaceConfig({ git: { noTicketKey: 'NO-TICKET' } }));
  const base = app('rev-parse', 'HEAD');
  const task = { id: 'x', ticket: 'ABC-123', branch: 'ABC-123/feature/mul-helper', base: { branch: 'main', commit: base } };
  app('switch', '-q', '-c', task.branch);
  assert.deepEqual(lintRange({ config, workTree: fx.app, task }).commits, []);

  write(fx.app, { 'a.txt': 'a\n' });
  app('add', '-A');
  app('commit', '-q', '-m', '[FEATURE] Add a\n\nRelates to ABC-123');
  write(fx.app, { 'b.txt': 'b\n' });
  app('add', '-A');
  app('commit', '-q', '-m', 'wip: b');
  // The cwd plays no role: the outer repo is on main and has no such branch.
  const result = lintRange({ config, workTree: fx.app, task });
  assert.deepEqual(result.commits.map((c) => c.subject), ['[FEATURE] Add a', 'wip: b']);
  assert.ok(result.errors >= 1);
  assert.ok(result.findings.every((f) => f.commit === result.commits[1].sha));
  assert.deepEqual(lintRange({ config, workTree: fx.app, task, last: true }).commits.map((c) => c.subject), ['wip: b']);

  app('switch', '-q', '-c', 'side', base);
  write(fx.app, { 'c.txt': 'c\n' });
  app('add', '-A');
  app('commit', '-q', '-m', '[TASK] Add c\n\nRelates to ABC-123');
  app('switch', '-q', task.branch);
  app('merge', '-q', '--no-edit', '-m', '[TASK] Merge side\n\nRelates to ABC-123', 'side');
  assert.ok(lintRange({ config, workTree: fx.app, task }).findings.some((f) => /merge commit/.test(f.message)));

  assert.throws(() => lintRange({ config, workTree: fx.app, task: { ...task, branch: 'ABC-123/feature/missing-one' } }), (error) => error.exitCode === 3 && /cw ws setup/.test(error.fix));
});

test('lintRange reports a PR/MR title that the flags of later commits push over the limit, on the first commit', (t) => {
  const fx = makeInPlace(t, { config: inPlaceConfig({ git: { noTicketKey: 'NO-TICKET' } }) });
  const app = gitIn(fx.app, fx.env);
  const config = withDefaults(inPlaceConfig({ git: { noTicketKey: 'NO-TICKET' } }));
  const task = { id: 'x', ticket: 'NO-TICKET', branch: 'NO-TICKET/feature/mul-helper', base: { branch: 'main', commit: app('rev-parse', 'HEAD') } };
  app('switch', '-q', '-c', task.branch);
  const commit = (file, message) => {
    write(fx.app, { [file]: `${file}\n` });
    app('add', '-A');
    app('commit', '-q', '-m', message);
  };
  // 65 characters: within the limit on its own.
  commit('a.txt', '[FEATURE] Add the multiplication helper to the math utilities mod');
  assert.equal(lintRange({ config, workTree: fx.app, task }).errors, 0);
  commit('b.txt', '[SECURITY][BUGFIX] Escape the input');
  const result = lintRange({ config, workTree: fx.app, task });
  const title = result.findings.filter((finding) => /PR\/MR title/.test(finding.message));
  assert.equal(result.errors, 1);
  assert.deepEqual(title.map((finding) => [finding.commit, finding.level]), [[result.commits[0].sha, 'error']]);
  assert.match(title[0].message, /"\[SECURITY\]\[FEATURE\] Add the multiplication helper to the math utilities mod" is 75 characters \(max 72\).*shorten this commit's summary/);
  const last = lintRange({ config, workTree: fx.app, task, last: true });
  assert.deepEqual([last.commits.length, last.errors], [1, 1], 'the last commit made the title too long, so --last reports it too');
  // Once the branch is pushed (or the PR/MR recorded) rebuilding it would need a force push: advisory.
  app('update-ref', `refs/remotes/origin/${task.branch}`, app('rev-parse', 'HEAD~1'));
  const pushed = lintRange({ config, workTree: fx.app, task });
  assert.equal(pushed.errors, 0);
  assert.match(pushed.findings.find((finding) => finding.kind === 'pr-title').message, /the branch is pushed already, so keep the commits/);
  app('update-ref', '-d', `refs/remotes/origin/${task.branch}`);
  assert.equal(lintRange({ config, workTree: fx.app, task: { ...task, prUrl: 'https://github.com/acme/app/pull/1' } }).errors, 0);
});
