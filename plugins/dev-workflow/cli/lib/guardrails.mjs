// The complexity guardrails, shared by the implementer agents (tools/generate-agents.mjs) and the
// briefs cw writes, so both say the same.

export const COMPLEXITIES = ['s', 'm', 'l', 'xl'];

export const GUARDRAILS = {
  s: [
    'Keep the diff minimal: 1–2 files, no change to existing behaviour or contracts.',
    'If the task turns out to need more, stop before expanding the scope and report `misclassified`.',
  ],
  m: [
    'Stay within one module. Additive, backward-compatible changes only.',
    'If you need to change an existing contract, schema or several modules, stop and report `misclassified`.',
  ],
  l: [
    'Before editing, read every affected module and list the contracts or schemas you change and all their callers.',
    'Update every caller in the same change, or keep the old contract working.',
    'Describe migration and deploy steps in your report.',
  ],
  xl: [
    'Investigate before changing code. State the root cause, or the design options with their trade-offs, backed by evidence from the code.',
    'Choose the smallest change that solves the problem and justify the choice in your report.',
    'Call out security, concurrency and data-integrity implications explicitly, and every protected rule the change touches.',
  ],
};

export const complexityRank = (complexity) => COMPLEXITIES.indexOf(complexity);
export const maxComplexity = (a, b) => (complexityRank(a) >= complexityRank(b) ? a : b);
