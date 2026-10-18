// SessionStart: report setup problems (doctor, rulebook drift) as facts; never changes anything.
import { readFileSync } from 'node:fs';
import { doctorCached, markReported } from '../scripts/lib/doctor.mjs';
import { resolvePacks } from '../scripts/lib/packs.mjs';
import { loadProfile } from '../scripts/lib/profile.mjs';
import { buildRulebook, diffRulebook } from '../scripts/lib/rules.mjs';
import { runHook } from './hook-lib.mjs';

await runHook('session-start', ({ input, ctx }) => {
  const { results, reported } = doctorCached(ctx);
  const problems = results.filter((result) => !result.ok && result.id !== 'rulebook');
  try {
    const profile = loadProfile(ctx);
    const book = buildRulebook(ctx, profile, resolvePacks(ctx, profile, { quiet: true }));
    const diff = diffRulebook(ctx, book, readFileSync(ctx.profilePath, 'utf8'));
    if (!diff.isCurrent) problems.push({ id: 'rulebook', level: 'warning', message: `The compiled rulebook in .claude/rules/workflow/ is out of date (${diff.problems.slice(0, 5).join('; ')}). \`cw rules build\` regenerates it.` });
  } catch (error) {
    problems.push({ id: 'profile', level: 'error', message: `The workflow profile cannot be loaded: ${error.message}` });
  }
  const ids = problems.map((problem) => `${problem.id}:${problem.message}`);
  const fresh = input.source === 'resume' ? problems.filter((problem, i) => !reported.includes(ids[i])) : problems;
  markReported(ctx, ids);
  if (!fresh.length) return null;
  return {
    systemMessage: `dev-workflow: ${fresh.length} setup issue(s): ${fresh.map((problem) => problem.id).join(', ')}. Details are in the session context.`,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: [
        'dev-workflow setup facts:',
        ...fresh.map((problem) => `- ${problem.message}`),
        '- These are mentioned to the user once before the first request; settings files are changed only by the user.',
      ].join('\n'),
    },
  };
}, { timeoutMs: 8000 });
