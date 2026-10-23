// Classification input (§6 O4, §5 complexity.escalate): the packages and areas the spec's paths touch,
// and the minimum complexity from the escalation rules of the config and the packs. Pure: the glob
// matcher and the pack rules are passed in.
import { packagesOf } from './config.mjs';
import { COMPLEXITIES, complexityRank } from './guardrails.mjs';
import { containsWord } from './packs.mjs';

// rules: [{ paths?, keywords?, min, reason, source }]; matchGlob(path, glob) -> boolean.
export function classify({ config, rules = [], paths = [], text = '', matchGlob }) {
  const { packages, unowned } = packagesOf(config, paths);
  const areas = [...new Set(packages.flatMap((pkg) => pkg.areas))];
  const matched = [];
  for (const rule of rules) {
    const pathHit = (rule.paths ?? []).flatMap((glob) => paths.filter((path) => matchGlob(path, glob)).map((path) => `path ${path} ~ ${glob}`))[0];
    const keywordHit = (rule.keywords ?? []).find((keyword) => containsWord(text, keyword));
    const hit = pathHit ?? (keywordHit ? `keyword "${keywordHit}"` : null);
    if (hit) matched.push({ source: rule.source, min: rule.min, reason: rule.reason, hit });
  }
  const minComplexity = matched.reduce((min, rule) => (complexityRank(rule.min) > complexityRank(min) ? rule.min : min), COMPLEXITIES[0]);
  const reasons = matched.length ? matched.map((rule) => `${rule.min}: ${rule.reason} (${rule.hit}, ${rule.source})`) : [`no escalation rule matched; the minimum is ${minComplexity}`];
  const warnings = paths.length ? [] : ['The spec names no paths, so no package is selected; add the affected files to the Context section.'];
  return { paths, packages: packages.map((pkg) => pkg.id), areas, unowned, minComplexity, reasons, matched, warnings };
}

// The config's escalation rules in the shape classify takes.
export const configRules = (config) => config.complexity.escalate.map((rule) => ({ ...rule, source: 'config' }));
