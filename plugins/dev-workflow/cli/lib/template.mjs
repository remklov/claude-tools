// {token} templates, their reverse (a template as a matching regex), and the branch name rules of a
// git preset (§10: {ticket}/{type}/{slug}, type feature|bugfix|hotfix, slug of 2–4 lowercase words).
import { usageError } from './out.mjs';

export function render(template, values) {
  return template.replace(/\{([a-zA-Z.]+)\}/g, (match, key) => {
    const value = key.split('.').reduce((object, part) => object?.[part], values);
    return value === undefined || value === null ? match : String(value);
  });
}

const escape = (text) => text.replace(/[\\^$+*?.()|[\]{}]/g, '\\$&');

// tokenPatterns maps token names to regex sources; unknown tokens match any non-empty text.
export function templateToRegExp(template, tokenPatterns = {}) {
  let source = '';
  let last = 0;
  for (const match of template.matchAll(/\{([a-zA-Z.]+)\}/g)) {
    source += escape(template.slice(last, match.index));
    source += `(${tokenPatterns[match[1]] ?? '.+?'})`;
    last = match.index + match[0].length;
  }
  source += escape(template.slice(last));
  return new RegExp(`^${source}$`);
}

export const SLUG_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+){1,3}';
export const isSlug = (slug) => new RegExp(`^${SLUG_PATTERN}$`).test(String(slug));

export function renderBranch(preset, { ticket, type, slug }) {
  if (!preset.types.includes(type)) {
    throw usageError(`--type ${type} is not allowed`, `Use one of ${preset.types.join(', ')}.`);
  }
  if (!new RegExp(preset.slug).test(String(slug))) {
    throw usageError(`--slug ${slug} is not a valid slug`, 'Use 2–4 lowercase words joined by hyphens, e.g. version-endpoint.');
  }
  return render(preset.branch, { ticket, type, slug });
}

// Matches branch names the preset would create, so a task branch is never used as a base.
export function branchPattern(preset, keyPattern, noTicketKey) {
  const key = String(keyPattern).replace(/^\^/, '').replace(/\$$/, '');
  return templateToRegExp(preset.branch, {
    ticket: `(?:${key})|${escape(noTicketKey)}|NO-TICKET`,
    type: preset.types.map(escape).join('|'),
    slug: '[a-z0-9]+(?:-[a-z0-9]+)*',
  });
}
