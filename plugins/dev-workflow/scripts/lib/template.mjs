// {token} and {token|lower} templates, and the reverse: a template turned into a matching regex.

export function render(template, values) {
  return template.replace(/\{([a-zA-Z.]+)(\|lower)?\}/g, (match, key, lower) => {
    const value = key.split('.').reduce((object, part) => object?.[part], values);
    if (value === undefined || value === null) return match;
    return lower ? String(value).toLowerCase() : String(value);
  });
}

const escape = (text) => text.replace(/[\\^$+*?.()|[\]{}]/g, '\\$&');

// tokenPatterns maps token names to regex sources; unknown tokens match any non-empty text.
export function templateToRegExp(template, tokenPatterns = {}) {
  let source = '';
  let last = 0;
  for (const match of template.matchAll(/\{([a-zA-Z.]+)(\|lower)?\}/g)) {
    source += escape(template.slice(last, match.index));
    const pattern = tokenPatterns[match[1]] ?? '.+?';
    source += `(${match[2] ? pattern.toLowerCase() : pattern})`;
    last = match.index + match[0].length;
  }
  source += escape(template.slice(last));
  return new RegExp(`^${source}$`);
}

export const SLUG_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+){1,3}';
export const isSlug = (slug) => new RegExp(`^${SLUG_PATTERN}$`).test(slug);
