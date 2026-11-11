export type ResolutionFinding = {
  definition: { id: string; item: string; title: string; caseId: string; viewports: string[] };
  revision: number; token: string; receivingHead: string; implementation: string; evidence: string; review: string;
  canResolve: boolean; blockers: string[]; assignment: string | null; expected: string; observed: string; nextAction: string | null; decision: string | null;
  integration: { commit: string; state: string }[];
  artifacts: { index: number; path: string; status: string; claim: string }[];
  inputs: { path: string; status: string }[];
  resolutionReview: null | { reviewer: string; savedUtc: string; action: string; notes: string };
};
