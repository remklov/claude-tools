// The user's decisions on review findings (ADR 0015). A finding needs one when the reviewer marked it
// (decision: true: an ambiguous spec, a ticket requirement the spec leaves out, a defect outside the
// change), and for every non-blocking correctness or security finding: no defect goes into a PR's open
// points without the user having seen it. task.decisions holds { review, reviewRound, finding, as,
// note, ... } per finding; a finding the next review carries over (carriedFrom) inherits its decision.

export const DECISIONS = ['fix', 'ticket', 'accept'];
const USER_RULES = new Set(['correctness', 'security']);

export const needsUser = (finding) => finding.decision === true || (finding.severity === 'non_blocking' && USER_RULES.has(finding.rule));

const sameReview = (decision, review) => decision.review === review.round && decision.reviewRound === review.reviewRound;

// The decision on a finding of a saved review (review-<n>.json, with round and reviewRound), or null.
export const decisionFor = (task, review, findingId) =>
  (task.decisions ?? []).find((decision) => sameReview(decision, review) && decision.finding === findingId) ?? null;

export const undecided = (task, review) => (review?.findings ?? []).filter((finding) => needsUser(finding) && !decisionFor(task, review, finding.id));

export const fixDecided = (task, review) => (review?.findings ?? []).filter((finding) => decisionFor(task, review, finding.id)?.as === 'fix');

const ids = (findings) => findings.map((finding) => finding.id).join(',');

export const decideCommand = (task, findings) =>
  `cw review decide --task ${task.id} --finding ${findings.length ? ids(findings) : '<F>'} --as fix|ticket|accept --note "<the user's answer>"`;

// The step that asks the user, for the Next lines and the refusals.
export const askUser = (task, findings) =>
  `ask the user about ${ids(findings)} in one AskUserQuestion (per finding: fix it in this task, a ticket for later, or accept it as it is; your recommendation first), then ${decideCommand(task, findings)} once per answer`;

// One decision record per finding; an earlier decision on the same finding is replaced.
export function recordDecisions(task, review, findings, { as, note, at }) {
  const kept = (task.decisions ?? []).filter((decision) => !(sameReview(decision, review) && findings.some((finding) => finding.id === decision.finding)));
  task.decisions = [
    ...kept,
    ...findings.map((finding) => ({
      review: review.round,
      reviewRound: review.reviewRound,
      finding: finding.id,
      severity: finding.severity,
      rule: finding.rule,
      file: finding.file ?? null,
      line: finding.line ?? null,
      issue: finding.issue,
      as,
      note,
      at,
      inheritedFrom: null,
    })),
  ];
}

// The decisions a new review inherits: each finding it carries over (carriedFrom) keeps the decision
// the user made on that finding of the previous review, so the user is not asked again.
export function inheritedDecisions(task, previous, review, findings, at) {
  if (!previous) return [];
  return findings.flatMap((finding) => {
    const earlier = finding.carriedFrom ? decisionFor(task, previous, finding.carriedFrom) : null;
    if (!earlier) return [];
    return [{
      ...earlier,
      review: review.round,
      reviewRound: review.reviewRound,
      finding: finding.id,
      severity: finding.severity,
      rule: finding.rule,
      file: finding.file ?? null,
      line: finding.line ?? null,
      issue: finding.issue,
      at,
      inheritedFrom: `${previous.round}.${previous.reviewRound}:${earlier.finding}`,
    }];
  });
}
