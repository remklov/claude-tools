// A small shell parser for the PreToolUse guard (§9): the simple commands a Bash command runs, so the
// guards see `git push` behind && || ; | & and newlines, inside $(…) and backticks (also within double
// quotes, ${…} words and unquoted heredoc bodies), in bash -c / sh -c strings, eval arguments and shell
// heredocs, and behind the wrappers env, command, exec, nohup, timeout, sudo (plus time, nice, xargs).
// /usr/bin/git is read as git.
// It is a backstop (D12), not a shell: expansions stay literal text, and forms it cannot read pass.

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
// Reserved words that may open a command; their command follows them.
const SKIP_WORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'esac', '!', '{', '}', 'time']);
const MAX_DEPTH = 8;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>', '<>']);

// The command name: the last path segment, so /usr/bin/git and ./git read as git.
export const commandName = (word) => (word.includes('/') ? word.slice(word.lastIndexOf('/') + 1) : word);

// args after the options of a wrapper. values: options that take the next word as their value.
function afterOptions(args, { values = [], assignments = null, operands = 0 } = {}) {
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--') {
      i += 1;
      break;
    }
    if (assignments && ASSIGNMENT.test(arg)) {
      assignments.push(arg);
      i += 1;
      continue;
    }
    if (!arg.startsWith('-') || arg === '-') break;
    i += values.includes(arg) ? 2 : 1;
  }
  return args.slice(i + operands);
}

// Each wrapper returns the command it runs, or null when it runs none.
const WRAPPERS = {
  env: (args, assignments) => {
    const split = args.findIndex((arg) => arg === '-S' || arg === '--split-string');
    if (split !== -1 && args[split + 1] !== undefined) return [...args[split + 1].split(/\s+/).filter(Boolean), ...args.slice(split + 2)];
    return afterOptions(args, { values: ['-u', '--unset', '-C', '--chdir'], assignments });
  },
  command: (args) => afterOptions(args),
  builtin: (args) => args,
  exec: (args) => afterOptions(args, { values: ['-a'] }),
  nohup: (args) => afterOptions(args),
  time: (args) => afterOptions(args, { values: ['-f', '--format', '-o', '--output'] }),
  nice: (args) => afterOptions(args, { values: ['-n', '--adjustment'] }),
  timeout: (args) => afterOptions(args, { values: ['-s', '--signal', '-k', '--kill-after'], operands: 1 }),
  sudo: (args, assignments) => afterOptions(args, { values: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U', '-R'], assignments }),
  xargs: (args) =>
    afterOptions(args, {
      values: ['-I', '-n', '-L', '-P', '-s', '-d', '-E', '-a', '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-lines', '--max-chars', '--eof', '--replace'],
    }),
};

const newCommand = () => ({ argv: [], assignments: [], redirects: [], heredocs: [] });

// The scripts a command runs itself: sh -c '<script>', eval <words>, and a shell that reads its
// script from a heredoc or a here-string.
function scriptsOf(command) {
  const [name, ...args] = command.argv;
  if (name === 'eval') return args.length ? [args.join(' ')] : [];
  if (!SHELLS.has(name)) return [];
  let i = 0;
  let inline = false;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--' || arg === '-') {
      i += 1;
      break;
    }
    if (['-o', '+o', '-O', '+O', '--rcfile', '--init-file'].includes(arg)) {
      i += 2;
      continue;
    }
    if (/^-[A-Za-z]+$/.test(arg)) {
      if (arg.includes('c')) inline = true;
      i += 1;
      continue;
    }
    if (/^(\+[A-Za-z]+|--.+)$/.test(arg)) {
      i += 1;
      continue;
    }
    break;
  }
  if (inline) return args[i] === undefined ? [] : [args[i]];
  if (i < args.length) return [];
  return [...command.heredocs.map((doc) => doc.body), ...command.redirects.filter((redirect) => redirect.op === '<<<').map((redirect) => redirect.target)];
}

// Strips assignments' companions and wrappers, normalizes the name, and appends the commands of the
// scripts the command runs itself. persistent: the command runs in the shell itself, not in a ( … )
// subshell, a $(…) or a script of its own, so a cd there moves the cwd of every later Bash call.
function finalize(raw, depth, subshell = false) {
  const assignments = [...raw.assignments];
  let argv = [...raw.argv];
  const wrappers = [];
  while (argv.length && Object.hasOwn(WRAPPERS, commandName(argv[0])) && wrappers.length < 8) {
    const name = commandName(argv[0]);
    wrappers.push(name);
    argv = WRAPPERS[name](argv.slice(1), assignments) ?? [];
  }
  if (argv.length) argv = [commandName(argv[0]), ...argv.slice(1)];
  const redirects = raw.redirects.map((redirect) => ({
    ...redirect,
    write: WRITE_OPS.has(redirect.op) || (redirect.op === '>&' && !/^(\d+-?|-)$/.test(redirect.target)),
  }));
  const command = { argv, assignments, redirects, heredocs: raw.heredocs, wrappers, persistent: depth === 0 && !subshell };
  const result = [command];
  if (depth < MAX_DEPTH) for (const script of scriptsOf(command)) result.push(...parseAt(script, 0, depth + 1, false).commands);
  return result;
}

// ANSI-C quoting ($'…'): the common escapes; returns [text, index after the closing quote].
function readAnsiC(text, from) {
  const simple = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', e: '\u001b', a: '\u0007' };
  let out = '';
  let i = from;
  while (i < text.length && text[i] !== "'") {
    if (text[i] === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      const hex = /^x([0-9A-Fa-f]{1,2})/.exec(text.slice(i + 1, i + 4));
      const octal = /^([0-7]{1,3})/.exec(text.slice(i + 1, i + 4));
      if (hex) {
        out += String.fromCharCode(Number.parseInt(hex[1], 16));
        i += 1 + hex[0].length;
      } else if (octal) {
        out += String.fromCharCode(Number.parseInt(octal[1], 8));
        i += 1 + octal[0].length;
      } else {
        out += simple[next] ?? `\\${next}`;
        i += 2;
      }
      continue;
    }
    out += text[i];
    i += 1;
  }
  return [out, i + 1];
}

// The index after the parenthesis that closes the one at open (for $((…)) arithmetic).
function skipParens(text, open) {
  let level = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') level += 1;
    else if (text[i] === ')') {
      level -= 1;
      if (level === 0) return i + 1;
    }
  }
  return text.length;
}

// Lexes text from start. untilParen: stop at the ")" that closes a $( or <( ; body: text is an
// unquoted heredoc body, read like the inside of double quotes. Returns the finished commands
// (substitutions before the command that contains them) and the index where lexing ended.
function parseAt(text, start, depth, untilParen, { body: bodyMode = false } = {}) {
  const entries = [];
  const heredocs = [];
  let command = newCommand();
  let word = null;
  let redirect = null;
  let parens = 0;
  let i = start;

  const startWord = () => {
    word ??= { text: '', quoteAt: -1 };
  };
  const markQuote = () => {
    startWord();
    if (word.quoteAt < 0) word.quoteAt = word.text.length;
  };
  const endWord = () => {
    if (!word) return;
    const done = word;
    word = null;
    if (redirect) {
      const { op, fd } = redirect;
      redirect = null;
      if (op === '<<' || op === '<<-') heredocs.push({ delimiter: done.text, strip: op === '<<-', quoted: done.quoteAt >= 0, command });
      else command.redirects.push({ op, fd, target: done.text });
      return;
    }
    if (!command.argv.length) {
      const unquotedEq = done.quoteAt < 0 || done.text.indexOf('=') < done.quoteAt;
      if (ASSIGNMENT.test(done.text) && unquotedEq) {
        command.assignments.push(done.text);
        return;
      }
      if (done.quoteAt < 0 && SKIP_WORDS.has(done.text)) return;
    }
    command.argv.push(done.text);
  };
  const endCommand = () => {
    endWord();
    redirect = null;
    if (command.argv.length || command.assignments.length || command.redirects.length) entries.push({ raw: command, subshell: parens > 0 });
    command = newCommand();
  };
  // A nested command list ($(…), <(…), >(…)); returns the index after its ")".
  const substitution = (from) => {
    const inner = parseAt(text, from, depth + 1, true);
    entries.push(...inner.commands.map((done) => ({ done })));
    return inner.end;
  };
  // A backtick substitution from the character after the opening backtick.
  const backtick = (from) => {
    let inner = '';
    let j = from;
    while (j < text.length && text[j] !== '`') {
      if (text[j] === '\\' && '$`\\'.includes(text[j + 1] ?? '')) {
        inner += text[j + 1];
        j += 2;
        continue;
      }
      inner += text[j];
      j += 1;
    }
    entries.push(...parseAt(inner, 0, depth + 1, false).commands.map((done) => ({ done })));
    return j + 1;
  };
  // A ${ … } parameter expansion from the character after "${": its word (${X:-$(git push)}) may hold
  // command substitutions, which run. Returns the index after the matching "}".
  const braced = (from) => {
    let level = 1;
    let j = from;
    while (j < text.length) {
      const d = text[j];
      if (d === '\\') j += 2;
      else if (d === '$' && text[j + 1] === '(' && text[j + 2] === '(') j = skipParens(text, j + 1);
      else if (d === '$' && text[j + 1] === '(') j = substitution(j + 2);
      else if (d === '$' && text[j + 1] === '{') {
        level += 1;
        j += 2;
      } else if (d === '`') j = backtick(j + 1);
      else if (d === '}') {
        level -= 1;
        j += 1;
        if (level === 0) return j;
      } else j += 1;
    }
    return text.length;
  };
  // $( … ), $(( … )) or ${ … } at i; returns the index after it, appending its source to the word.
  const dollar = () => {
    const next = text[i + 1];
    let end;
    if (next === '(' && text[i + 2] === '(') end = skipParens(text, i + 1);
    else if (next === '(') end = substitution(i + 2);
    else if (next === '{') end = braced(i + 2);
    else return null;
    word.text += text.slice(i, end);
    return end;
  };
  // The inside of double quotes from i up to the closing quote (close null: to the end of the text, for
  // an unquoted heredoc body): $(…), backticks and ${…} expand there, everything else is text.
  const quoted = (close) => {
    while (i < text.length && text[i] !== close) {
      const d = text[i];
      if (d === '\\' && i + 1 < text.length) {
        const e = text[i + 1];
        if (e !== '\n') word.text += '$`"\\'.includes(e) ? e : `\\${e}`;
        i += 2;
        continue;
      }
      if (d === '$') {
        const end = dollar();
        if (end !== null) {
          i = end;
          continue;
        }
      }
      if (d === '`') {
        const end = backtick(i + 1);
        word.text += text.slice(i, end);
        i = end;
        continue;
      }
      word.text += d;
      i += 1;
    }
  };
  // Heredoc bodies follow the line that opened them. An unquoted one (<<EOF) expands $(…), backticks
  // and ${…} as double quotes do: those commands run before the command that reads the heredoc.
  const readHeredocs = () => {
    for (const doc of heredocs.splice(0)) {
      let body = '';
      while (i < text.length) {
        const newline = text.indexOf('\n', i);
        const line = text.slice(i, newline === -1 ? text.length : newline);
        i = newline === -1 ? text.length : newline + 1;
        if ((doc.strip ? line.replace(/^\t+/, '') : line) === doc.delimiter) break;
        body += `${line}\n`;
      }
      doc.command.heredocs.push({ body, quoted: doc.quoted });
      if (!doc.quoted && depth < MAX_DEPTH) {
        const inner = parseAt(body, 0, depth + 1, false, { body: true }).commands.map((done) => ({ done }));
        const at = entries.findIndex((entry) => entry.raw === doc.command);
        entries.splice(at === -1 ? entries.length : at, 0, ...inner);
      }
    }
  };
  if (bodyMode) {
    startWord();
    quoted(null);
    return { commands: finish(entries, depth), end: text.length };
  }

  while (i < text.length) {
    const c = text[i];
    if (c === '\n') {
      endCommand();
      i += 1;
      if (heredocs.length) readHeredocs();
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i += 1;
      continue;
    }
    if (c === '\\') {
      if (text[i + 1] === '\n') {
        i += 2;
        continue;
      }
      markQuote();
      word.text += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === "'") {
      markQuote();
      const close = text.indexOf("'", i + 1);
      const end = close === -1 ? text.length : close;
      word.text += text.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '$' && text[i + 1] === "'") {
      markQuote();
      const [value, end] = readAnsiC(text, i + 2);
      word.text += value;
      i = end;
      continue;
    }
    if (c === '"') {
      markQuote();
      i += 1;
      quoted('"');
      i += 1;
      continue;
    }
    if (c === '`') {
      startWord();
      const end = backtick(i + 1);
      word.text += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === '$') {
      startWord();
      const end = dollar();
      if (end !== null) {
        i = end;
        continue;
      }
    }
    if ((c === '<' || c === '>') && text[i + 1] === '(') {
      endWord();
      startWord();
      const end = substitution(i + 2);
      word.text += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === '#' && !word) {
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline;
      continue;
    }
    if (c === '&') {
      if (text[i + 1] === '&') {
        endCommand();
        i += 2;
      } else if (text[i + 1] === '>') {
        endWord();
        const op = text[i + 2] === '>' ? '&>>' : '&>';
        redirect = { op, fd: null };
        i += op.length;
      } else {
        endCommand();
        i += 1;
      }
      continue;
    }
    if (c === '|') {
      endCommand();
      i += text[i + 1] === '|' || text[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if (c === ';') {
      endCommand();
      i += text[i + 1] === ';' ? 2 : 1;
      continue;
    }
    if (c === '(') {
      endCommand();
      parens += 1;
      i += 1;
      continue;
    }
    if (c === ')') {
      endCommand();
      i += 1;
      if (untilParen && parens === 0) return { commands: finish(entries, depth), end: i };
      parens = Math.max(0, parens - 1);
      continue;
    }
    if (c === '<' || c === '>') {
      let fd = null;
      if (word && word.quoteAt < 0 && /^\d+$/.test(word.text)) {
        fd = Number(word.text);
        word = null;
      } else endWord();
      const ops = c === '>' ? ['>>', '>|', '>&', '>'] : ['<<<', '<<-', '<<', '<&', '<>', '<'];
      const op = ops.find((candidate) => text.startsWith(candidate, i));
      redirect = { op, fd };
      i += op.length;
      continue;
    }
    startWord();
    word.text += c;
    i += 1;
  }
  endCommand();
  return { commands: finish(entries, depth), end: text.length };
}

function finish(entries, depth) {
  return entries.flatMap((entry) => (entry.done ? [entry.done] : finalize(entry.raw, depth, entry.subshell)));
}

// The simple commands of a shell text, in the order they run (a substitution before the command
// that uses it): { argv, assignments, redirects: [{ op, fd, target, write }], heredocs, wrappers }.
export const parseShell = (text) => parseAt(String(text ?? ''), 0, 0, false).commands;
