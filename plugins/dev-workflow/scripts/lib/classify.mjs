// Classification: affected packages and areas, minimum complexity, split recommendation (spec 02 §4.1).
import { matchAny } from './glob.mjs';
import { packComplexityRules } from './packs.mjs';
import { containsWord, procedureApplies, proceduresFor, ROLES } from './playbook.mjs';
import { complexityRank, maxComplexity, packagesOf } from './profile.mjs';

export function classify(ctx, profile, packs, { paths: allPaths, text }) {
  // Docs the spec only cites (plans, manuals) don't make their package affected unless nothing else is.
  const docsOnly = profile.knowledgeBase.docsOnlyPaths ?? [];
  const codePaths = allPaths.filter((path) => !matchAny(path, docsOnly));
  const paths = codePaths.length ? codePaths : allPaths;
  const { packages, unowned } = packagesOf(profile, paths);
  const areas = [...new Set(packages.flatMap((pkg) => pkg.areas))];
  let minComplexity = 's';
  const reasons = [];
  for (const rule of [...profile.complexity.escalate, ...packComplexityRules(packs)]) {
    const pathHit = (rule.paths ?? []).length && paths.some((path) => matchAny(path, rule.paths));
    const word = (rule.keywords ?? []).find((keyword) => containsWord(text, keyword));
    if (!pathHit && !word) continue;
    if (complexityRank(rule.min) > complexityRank(minComplexity)) minComplexity = maxComplexity(minComplexity, rule.min);
    reasons.push(`${rule.min}: ${rule.reason ?? 'escalation rule'} (${pathHit ? 'path match' : `keyword "${word}"`})`);
  }
  if (!reasons.length) reasons.push('no escalation rule matched; minimum is s');
  const ordered = profile.split.order.filter((id) => packages.some((pkg) => pkg.id === id));
  const splitRecommended = profile.split.mode !== 'none' && ordered.length >= 2 && complexityRank(minComplexity) >= complexityRank(profile.split.threshold);
  const procedures = {};
  for (const role of ROLES) {
    procedures[role] = proceduresFor(ctx, packs, role)
      .filter((procedure) => procedureApplies(procedure, { paths, areas, text }))
      .map((procedure) => `${procedure.origin}/${procedure.name}`);
  }
  return { paths: allPaths, packages: packages.map((pkg) => pkg.id), areas, unowned, minComplexity, reasons, splitRecommended, order: ordered, procedures };
}
