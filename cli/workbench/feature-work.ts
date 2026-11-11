import type { CatalogItem } from './catalog-view';
export type FeatureWorkKind = 'implementation' | 'tooling' | 'review' | 'complete';
export const featureWorkLabels: Record<FeatureWorkKind, string> = { implementation: 'Needs implementation', tooling: 'Missing tooling', review: 'Needs review', complete: 'Complete' };
/** Independent work tracks. Missing evidence never proves a game defect or grants review eligibility. */
export function featureWork(item: CatalogItem) {
  const coverage = item.acceptance;
  const defects = item.issues.filter(issue => issue.kind === 'defect').length;
  const triage = item.issues.filter(issue => ['review', 'untriaged'].includes(issue.kind)).length;
  const toolingIssues = item.issues.filter(issue => issue.kind === 'tooling').length;
  const complete = coverage?.status === 'accepted';
  const implementation = !complete && (item.implementation === 'in-progress' || defects > 0 || (coverage?.nextSteps.fix ?? 0) > 0);
  const tooling = !complete && (!coverage || coverage.required === 0 || coverage.missingAdapters > 0 || toolingIssues > 0 || (coverage.nextSteps.setup ?? 0) > 0);
  const review = !complete && (triage > 0 || item.implementation === 'not-assessed' || (coverage !== null && (coverage.ready > 0 || coverage.unmeasured > 0 || (coverage.nextSteps.recheck ?? 0) > 0 || (coverage.nextSteps.gates ?? 0) > 0 || (coverage.nextSteps.recover ?? 0) > 0 || (coverage.nextSteps.capture ?? 0) > 0)));
  const flags = { implementation, tooling, review, complete };
  const primary: FeatureWorkKind = complete ? 'complete' : implementation ? 'implementation' : tooling ? 'tooling' : 'review';
  const descriptions = {
    implementation: defects ? `${defects} product ${defects === 1 ? 'finding' : 'findings'} to address` : item.implementation === 'in-progress' ? 'Implementation declared in progress' : item.implementation === 'implemented' ? 'Implementation declared complete' : 'Implementation not assessed',
    tooling: !coverage || !coverage.required ? 'Primary acceptance cases not defined' : `${coverage.missingAdapters} primary checks lack direct adapters${toolingIssues ? ` · ${toolingIssues} tooling ${toolingIssues === 1 ? 'finding' : 'findings'}` : ''}${coverage.nextSteps.setup ? ` · ${coverage.nextSteps.setup} setup blockers` : ''}`,
    review: `${coverage?.ready ?? 0} checks ready for approval · ${triage} findings to triage${coverage?.unmeasured ? ` · ${coverage.unmeasured} captured checks need measurements` : ''}${coverage?.nextSteps.recheck ? ` · ${coverage.nextSteps.recheck} checks have changed or unknown inputs` : ''}`,
    complete: coverage ? `${coverage.accepted} / ${coverage.required} primary checks complete` : 'No primary checks defined',
  };
  return { flags, primary, descriptions };
}
