import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Input, Section, connectHelix } from '@helix/kit';
import { AcceptanceMatrix } from './AcceptanceMatrix';
import type { CatalogItem, CatalogReport } from './catalog-view';

async function request(route: string, body: unknown, signal: AbortSignal) {
  const response = await connectHelix().fetchBackend(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}
function Evidence({ root, item }: { root: string; item: CatalogItem }) {
  const [preview, setPreview] = useState<{ url: string; mime: string; name: string; text: string | null } | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const requestOwner = useRef<AbortController | null>(null), url = useRef<string | null>(null);
  useEffect(() => () => { requestOwner.current?.abort(); if (url.current) URL.revokeObjectURL(url.current); }, []);
  async function open(artifact: number) {
    requestOwner.current?.abort(); const abort = new AbortController(); requestOwner.current = abort;
    if (url.current) URL.revokeObjectURL(url.current); setPreview(null); setError(''); setBusy(true);
    try {
      const response = await request('/acceptance/catalog-evidence', { path: root, item: item.id, artifact, expectedPath: item.evidence[artifact]!.path, expectedSha256: item.evidence[artifact]!.sha256 }, abort.signal);
      const blob = await response.blob();
      const text = ['application/json', 'text/plain'].includes(blob.type) ? await blob.text() : null;
      if (abort.signal.aborted) return;
      url.current = URL.createObjectURL(blob); setPreview({ url: url.current, mime: blob.type, name: item.evidence[artifact]!.path, text });
    } catch (error) { if (!abort.signal.aborted) setError(String(error)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  return <Section title={`Retained evidence (${item.evidence.length})`} size="sm" variant="ruled" contentClassName="space-y-2">
    <p className="text-xs text-muted-foreground">Local presence is checked now; recorded hashes are verified when opened. Historical evidence does not establish current parity. Missing files retain their original recovery references.</p>
    <div className="max-h-64 overflow-auto space-y-2">{item.evidence.map((artifact, index) => <div key={`${artifact.path}:${artifact.sha256}`} className="border-b p-1 text-xs"><p className="break-all">{artifact.path}</p><p>{artifact.origin} · {artifact.availability}</p>{artifact.availability.startsWith('local;') && <Button size="xs" variant="outline" disabled={busy} onClick={() => void open(index)}>Open evidence {index + 1}</Button>}</div>)}</div>
    {!item.evidence.length && <p className="text-xs">No evidence linked yet.</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {preview && <div className="space-y-2"><p className="text-xs break-all">{preview.name}</p>{preview.mime.startsWith('image/') ? <img src={preview.url} alt="Selected catalog evidence" className="max-h-96 object-contain" /> : preview.mime.startsWith('video/') ? <video controls src={preview.url} className="max-h-96" /> : preview.mime.startsWith('audio/') ? <audio controls src={preview.url} /> : preview.text !== null ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{preview.text}</pre> : null}<a className="text-xs underline" href={preview.url} download={preview.name.split('/').pop()}>Download retained file</a></div>}
  </Section>;
}
export function GameCatalog({ root, project, renderComparisons }: { root: string; project: string; renderComparisons: (item: CatalogItem) => ReactNode }) {
  const [report, setReport] = useState<CatalogReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [query, setQuery] = useState(''), [scope, setScope] = useState('game'), [group, setGroup] = useState('all'), [filter, setFilter] = useState('all'), [selected, setSelected] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError('');
    void (async () => {
      try { const response = await request('/acceptance/catalog', { path: root }, abort.signal); const result = await response.json(); if (result.format !== 'helix-game-catalog' || result.project !== project || result.version !== 1) throw new Error('Unsupported catalog response'); if (!abort.signal.aborted) setReport(result); }
      catch (error) { if (!abort.signal.aborted) setError(String(error)); }
      finally { if (!abort.signal.aborted) setBusy(false); }
    })(); return () => abort.abort();
  }, [root, project, revision]);
  const entries = report?.entries ?? [];
  const visible = entries.filter(item => (scope === 'all' || item.scope === scope) && (group === 'all' || item.group === group) && `${item.title} ${item.id} ${item.summary}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'gaps' ? item.acceptance === null : filter === 'issues' ? item.issues.some(issue => issue.status === 'open' || issue.status === 'blocked') : item.acceptance?.status === 'accepted')));
  const active = visible.find(item => item.id === selected);
  return <Section title="Whole-game screen and feature catalog" variant="card" contentClassName="space-y-3">
    <p className="text-xs">Browse the whole inventory, then inspect source coverage, current discrepancies, retained evidence and scoped human review. Win is one entry.</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh catalog</Button><Input aria-label="Search catalog" placeholder="Search screens and features" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Catalog scope" value={scope} onChange={event => setScope(event.target.value)}><option value="game">Game</option><option value="all">All entries</option><option value="tooling">Tooling</option><option value="reference-only">Reference-only variants</option></select><select aria-label="Catalog group" value={group} onChange={event => setGroup(event.target.value)}><option value="all">All groups</option>{[...new Set(entries.map(item => item.group))].sort().map(value => <option key={value}>{value}</option>)}</select><select aria-label="Catalog coverage filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All coverage</option><option value="gaps">Coverage not defined</option><option value="issues">Open discrepancies</option><option value="accepted">Accepted scope</option></select></div>
    {busy && <p role="status" className="text-xs">Reading catalog and current records…</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {report && <><p className="text-xs">{report.summary.game} game entries · {report.summary.total} total · {report.summary.definedCoverage} with defined review coverage · {report.summary.accepted} accepted scopes · {report.summary.discrepancies} unique discrepancies</p><p className="text-xs text-muted-foreground">These are inventory counts, not a game completion percentage. Accepted scopes cover only their declared cases.</p></>}
    {report && <details className="text-xs"><summary>Declared product exclusions ({report.exclusions.length})</summary><ul className="list-disc pl-4">{report.exclusions.map(value => <li key={value}>{value}</li>)}</ul></details>}
    <div className="max-h-96 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Screen / feature</th><th>Coverage / review</th><th>Discrepancies</th><th>Evidence</th></tr></thead><tbody>{visible.map(item => <tr key={item.id} className={active?.id === item.id ? 'bg-accent' : ''}><td className="p-2"><button className="underline text-left" onClick={() => setSelected(item.id)}>{item.title}</button><p className="text-muted-foreground">{item.group} · {item.kind}</p></td><td>{item.acceptance ? <><p>✓ {item.acceptance.verified} criteria verified · ✕ {item.acceptance.mismatches} need fixing</p><p>◷ {item.acceptance.pendingReview} captured cases await human review</p><p>{item.acceptance.accepted}/{item.acceptance.required} accepted cases</p></> : '○ Coverage not defined'}</td><td>{item.issues.filter(issue => issue.status === 'resolved').length} resolved · {item.issues.filter(issue => issue.status === 'open' || issue.status === 'blocked').length} open · {item.issues.filter(issue => issue.status === 'accepted-deviation').length} deviations</td><td>{item.evidence.length} references · {item.comparisons.length} comparisons</td></tr>)}</tbody></table></div>
    {!visible.length && !busy && <p className="text-xs">No entries match these filters.</p>}
    {!active && visible.length > 0 && <p className="text-xs">Select a screen or feature to review its evidence and gaps.</p>}
    {active && <Section title={active.title} variant="ruled" contentClassName="space-y-3"><p className="text-xs">{active.summary}</p><p className="text-xs">Implementation: {active.implementation}</p>{active.missingSources.map(path => <p key={path} role="alert" className="text-xs">Missing source: {path}</p>)}<details className="text-xs"><summary>Definition and implementation sources</summary>{[...active.sources, ...active.implementationReferences].map(path => <p key={path} className="break-all">{path}</p>)}</details>
      {active.legacy && <details className="text-xs"><summary>Historical agent claim: {active.legacy.status} · {active.legacy.reportedUtc}</summary><p>{active.legacy.summary}</p><p>This dated claim is not current acceptance.</p></details>}
      <Section title={`Discrepancies (${active.issues.length})`} size="sm" variant="ruled" contentClassName="space-y-2">{active.issues.map(issue => <details key={issue.id} className="text-xs border-b py-1"><summary>{issue.status} · {issue.id} · revision {issue.revision}</summary><p>Expected: {issue.expected}</p><p>Observed: {issue.observed}</p>{issue.nextAction !== null && <p>Next action: {issue.nextAction}</p>}<p className="break-all">{issue.path}</p></details>)}{!active.issues.length && <p className="text-xs">No discrepancies linked. This does not establish a match.</p>}</Section>
      <Evidence key={`${root}:${active.id}:${revision}`} root={root} item={active} />{renderComparisons(active)}
      {active.acceptanceItem !== null ? <AcceptanceMatrix key={active.id} root={root} project={project} itemId={active.acceptanceItem} /> : <p className="text-xs">Review coverage is not defined yet. Add scoped cases and capture observations before requesting acceptance. Existing discrepancy resolutions do not fill this gap.</p>}
    </Section>}
    {report && <><p className="text-xs text-muted-foreground">Checked {report.assessedUtc}. Definitions live in Tools/Helix/catalog/catalog.json.</p>{report.unmappedDiscrepancies.length > 0 && <p role="alert" className="text-xs">Unmapped discrepancies: {report.unmappedDiscrepancies.join(', ')}</p>}{report.unmappedComparisons.length > 0 && <p role="alert" className="text-xs">{report.unmappedComparisons.length} comparisons have no catalog entry link. They remain available under All comparisons.</p>}{report.warnings.map(warning => <p key={warning} role="alert" className="text-xs">{warning}</p>)}</>}
  </Section>;
}
