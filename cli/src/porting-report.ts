import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { relative, dirname, posix } from 'node:path';
import { evidencePath } from './evidence-archive.ts';
import { catalogPath, catalogStatus } from './catalog.ts';
import { acceptanceStatus, loadAcceptance } from './acceptance.ts';
import { loadQaReconciliation } from './qa-reconciliation.ts';
import { readQaSource } from './qa-source.ts';
import { loadJourneys } from './journeys.ts';
import { digest, readRun, portablePath } from './acceptance-format.ts';

const marker = '<!-- helix-evidence-report: generated; status ownership is configured in Tools/Helix/report.json -->';
export type ReportLocation = { title: string; scope: string; status: string; output: string };
export function readReportLocation(root: string): ReportLocation {
  const value = JSON.parse(readFileSync(catalogPath(root, 'Tools/Helix/report.json'), 'utf8'));
  if (value.version !== 1 || Object.keys(value).sort().join() !== 'output,scope,status,title,version' || !['title', 'scope'].every(key => typeof value[key] === 'string' && value[key].trim())) throw new Error('Invalid evidence report configuration');
  portablePath(value.status); portablePath(value.output);
  if (!value.status.endsWith('.md') || /\.(md|html)$/.test(value.output) || [value.output + '.md', value.output + '.html'].includes(value.status)) throw new Error('Report output must be a stem distinct from the existing status document');
  if (!existsSync(catalogPath(root, value.status))) throw new Error('Configured status document does not exist: ' + value.status);
  catalogPath(root, value.output + '.md'); catalogPath(root, value.output + '.html');
  return value;
}
const html = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const md = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\\`*_{}\[\]()|]/g, '\\$&').replaceAll('\n', ' ');
type Source = { path: string; title: string; label: string; delivery: string; summary: string; verdict: string; at: string; artifacts?: { path: string; hrefPath: string; sha256: string; availability: string; recovery: string }[] };
export function renderPortingReport(model: { location: ReportLocation; project: string; reconciledUtc: string; sources: Source[]; journeys: { title: string; sources: string[] }[]; findings: { id: string; expected: string; observed: string; path: string; kind: string; status: string }[] }) {
  const href = (path: string) => posix.relative(posix.dirname(model.location.output), path).split('/').map(encodeURIComponent).join('/');
  const markdown = [marker, '# ' + md(model.location.title), '', `[Existing status and next steps](${href(model.location.status)}) · [HTML evidence index](${href(model.location.output + '.html')})`, '', md(model.location.scope), '',
    'Implementation and QA are owned by AI Kit. This is a repository snapshot of recorded QA and evidence, not a completion score or a live board. AK numbers are original local labels only. Referenced media may require separate recovery; an archived path is not proof that the media ships in Git.', '',
    `Project: ${md(model.project)}. Evidence reconciliation: ${md(model.reconciledUtc)}.`, '', '## Recorded QA', '', '| Work | Recorded delivery / QA | Submitted | Original evidence |', '| --- | --- | --- | --- |'];
  for (const source of model.sources) markdown.push(`| ${md(source.title)} | ${md(source.delivery)} / ${md(source.verdict)} | ${md(source.at)} | [${md(source.label)} — record](${href(source.path)}) |`);
  const tableStart = markdown.findIndex(line => line.startsWith('|'));
  const table = markdown.slice(tableStart).map(line => line.slice(2, -2).split(' | '));
  const widths = table[0].map((_, column) => Math.max(...table.map(row => row[column].length)));
  markdown.splice(tableStart, table.length, ...table.map((row, index) => '| ' + row.map((cell, column) => index === 1 ? '-'.repeat(widths[column]) : cell.padEnd(widths[column])).join(' | ') + ' |'));
  const artifacts = new Map(model.sources.flatMap(source => (source.artifacts ?? []).map(artifact => [JSON.stringify([artifact.path, artifact.sha256]), artifact] as const)));
  markdown.push('', '## Shared originals', '', 'Imported run outcomes are recorded observations, not new QA sign-offs. Availability checks bytes only; it does not establish current source freshness. Paths below are repository-relative recovery locators; the local HTML index links available originals.', '');
  for (const artifact of artifacts.values()) markdown.push(`- ${md(artifact.path)} — ${md(artifact.availability)}; SHA-256: ${artifact.sha256}; recovery: ${md(artifact.recovery)}`);
  markdown.push('', '## Journeys and shared evidence', '');
  for (const journey of model.journeys) markdown.push(`### ${md(journey.title)}`, '', ...(journey.sources.length ? journey.sources.map(path => { const source = model.sources.find(source => source.path === path)!; return `- [${md(source.title)}](${href(path)})`; }) : ['No QA snapshot linked yet. This is an evidence-linking gap, not an implementation verdict.']), '');
  markdown.push('## Discrepancies and triage', '');
  for (const finding of model.findings) markdown.push(`### [${md(finding.id)}](${href(finding.path)})`, '', `Classification: ${md(finding.kind === 'untriaged' ? 'Needs triage' : finding.kind)} · ${md(finding.status)}`, '', `Expected: ${md(finding.expected)}`, '', `Observed: ${md(finding.observed)}`, '');
  if (!model.findings.length) markdown.push('No active discrepancies or triage records in the current index. This does not assert exhaustive parity.', '');
  markdown.push('## Updating this report', '', 'Agents: update the configured existing status document through its owner with scoped delivery notes and evidence links. Retain the original QA verdicts and approved exceptions in portable snapshots; update the evidence mappings and discrepancy records, then run:', '', '```sh', './Tools/Helix/bin/helix evidence-report', '```', '', 'Regeneration reads repository files only. It does not contact AI Kit, start Helix or Unity, or run gameplay. Only the configured evidence index is generated; the existing status document is never overwritten.', '');
  const link = (path: string, title: string) => `<a href="${href(path)}">${html(title)}</a>`;
  const page = `${marker}\n<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${html(model.location.title)}</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:40px auto;padding:0 24px;color:#202630;background:#fafbfc}a{color:#235fc4}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #dce0e6;vertical-align:top}details{border:1px solid #dce0e6;border-radius:8px;padding:12px;margin:10px 0}summary{cursor:pointer;font-weight:600}.muted{color:#596373}nav{display:flex;gap:20px;flex-wrap:wrap}code{background:#e9edf2;padding:4px}h2{margin-top:36px}</style><h1>${html(model.location.title)}</h1><p>${html(model.location.scope)}</p><nav>${link(model.location.status,'Existing status and next steps')}${link(model.location.output + '.md','Markdown')}<a href="#qa">Recorded QA</a><a href="#journeys">Shared evidence</a><a href="#differences">Discrepancies</a></nav><p class="muted">Repository evidence snapshot, not a completion score or live board. AI Kit owns implementation and QA. AK numbers are original local labels; archived media paths may require recovery.</p><p>${html(model.project)} · Reconciled ${html(model.reconciledUtc)}</p><h2 id="qa">Recorded QA</h2><table><thead><tr><th>Work</th><th>Recorded delivery / QA</th><th>Submitted</th></tr></thead><tbody>${model.sources.map(source => `<tr><td>${link(source.path, source.title)}<br><small>${html(source.label)} · record</small></td><td>${html(source.delivery)} / ${html(source.verdict)}<details><summary>Read original QA scope</summary><p style="white-space:pre-wrap">${html(source.summary)}</p></details></td><td>${html(source.at)}</td></tr>`).join('')}</tbody></table><h2>Shared originals</h2><p>Recorded run outcomes are not QA sign-offs. Availability verifies bytes, not current source freshness.</p><ul>${[...artifacts.values()].map(artifact => `<li>${link(artifact.hrefPath,artifact.path)} — ${html(artifact.availability)}; SHA-256: ${artifact.sha256}; recovery: ${html(artifact.recovery)}</li>`).join('')}</ul><h2 id="journeys">Journeys and shared evidence</h2>${model.journeys.map(journey => `<details><summary>${html(journey.title)}</summary>${journey.sources.length ? '<ul>' + journey.sources.map(path => `<li>${link(path, model.sources.find(source => source.path === path)!.title)}</li>`).join('') + '</ul>' : '<p>No QA snapshot linked yet; not an implementation verdict.</p>'}</details>`).join('')}<h2 id="differences">Discrepancies and triage</h2>${model.findings.map(finding => `<details><summary>${html(finding.id)}</summary><p>${html(finding.kind === 'untriaged' ? 'Needs triage' : finding.kind)} · ${html(finding.status)}</p><p><strong>Expected:</strong> ${html(finding.expected)}</p><p><strong>Observed:</strong> ${html(finding.observed)}</p>${link(finding.path,'Original record')}</details>`).join('') || '<p>No active product discrepancies in the index. This does not assert exhaustive parity.</p>'}<h2>Agent updates</h2><p>Update ${link(model.location.status,'the existing status document through its owner')}, retain portable QA snapshots and update evidence mappings, then regenerate with <code>./Tools/Helix/bin/helix evidence-report</code>. No servers, AI Kit installation or gameplay execution required.</p></html>\n`;
  return { markdown: markdown.join('\n'), html: page };
}
export async function writePortingReport(root: string, project: string) {
  const location = readReportLocation(root);
  const paths = [location.output + '.md', location.output + '.html'].map(path => catalogPath(root, path));
  for (const path of paths) if (existsSync(path) && !readFileSync(path, 'utf8').startsWith(marker)) throw new Error('Refusing to overwrite a hand-authored report: ' + path);
  const document = loadQaReconciliation(root, project);
  const sources = new Map<string, Source>();
  for (const binding of document?.bindings ?? []) for (const source of binding.sources) {
    if (sources.has(source.path)) continue;
    const bytes = readFileSync(catalogPath(root, source.path));
    if (digest(bytes) !== source.sha256) throw new Error('QA snapshot changed: ' + source.path);
    const { record } = readQaSource(JSON.parse(bytes.toString()), source.sha256);
    const verdict = record.kind === 'task' ? record.test : record.signOff.lastVerdict;
    if (typeof record.title !== 'string' || typeof verdict.at !== 'string' || typeof verdict.summary !== 'string' || typeof record.state !== 'string') throw new Error('QA snapshot lacks title or submitted verdict: ' + source.path);
    sources.set(source.path, { path: source.path, title: record.title, label: record.key, delivery: record.state, summary: verdict.summary, verdict: record.kind === 'task' ? verdict.result : (record.checks?.find((check: any) => check.id === verdict.checkId)?.outcome ?? 'QA report recorded — read scope'), at: verdict.at });
  }
  const runsDirectory = catalogPath(root, 'Tools/Helix/acceptance/runs');
  const runs = (existsSync(runsDirectory) ? readdirSync(runsDirectory).filter(file => file.endsWith('.json')).sort() : []).map(file => {
    const path = 'Tools/Helix/acceptance/runs/' + file;
    const run = readRun(JSON.parse(readFileSync(catalogPath(root, path), 'utf8')));
    if (run.project !== project || file !== run.id + '.json') throw new Error('Run identity mismatch: ' + path);
    sources.set(path, { path, title: `${run.item} / ${run.caseId} / ${run.viewport}`, label: run.id, delivery: 'Imported evidence', summary: run.notes, verdict: run.outcome, at: run.capturedUtc, artifacts: run.artifacts.map(pin => {
      const absolute = evidencePath(root, pin.path);
      return { ...pin, hrefPath: relative(root, absolute).split('\\').join('/'), availability: !existsSync(absolute) ? 'Missing locally' : digest(readFileSync(absolute)) === pin.sha256 ? 'Hash verified' : 'Hash mismatch' };
    }) });
    return { path, run };
  });
  const { screens, supplemental } = loadAcceptance(root, project), manifest = loadJourneys(root, project, screens, supplemental);
  const catalog = catalogStatus(root, project, await acceptanceStatus(root, project));
  const findings = new Map(catalog.findings.filter(issue => ['open', 'blocked'].includes(issue.status) && ['defect', 'untriaged', 'review'].includes(issue.kind)).map(issue => [issue.id, issue] as const));
  const rendered = renderPortingReport({ location, project, reconciledUtc: document?.reconciledUtc ?? 'No QA reconciliation imported', sources: [...sources.values()].sort((a,b) => a.title.localeCompare(b.title)), journeys: (manifest?.journeys ?? []).map(journey => { const keys = new Set(journey.branches.flatMap(branch => branch.checks.map(check => JSON.stringify([check.item, check.caseId])))); return { title: journey.title, sources: [...new Set((document?.bindings ?? []).filter(binding => keys.has(JSON.stringify([binding.item, binding.caseId]))).flatMap(binding => binding.sources.map(source => source.path)).concat(runs.filter(({run}) => keys.has(JSON.stringify([run.item, run.caseId]))).map(({path}) => path)))].sort() }; }), findings: [...findings.values()] });
  mkdirSync(dirname(paths[0]), { recursive: true });
  writeFileSync(paths[0], rendered.markdown); writeFileSync(paths[1], rendered.html);
  return { status: 'written', markdown: location.output + '.md', html: location.output + '.html', statusDocument: location.status, snapshots: sources.size - runs.length, runs: runs.length, discrepancies: findings.size };
}
