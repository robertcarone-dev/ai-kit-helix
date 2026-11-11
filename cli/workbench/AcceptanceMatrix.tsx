import { useEffect, useRef, useState } from 'react';
import { Button, Input, Section, connectHelix } from '@helix/kit';
import type { AcceptanceReport, CaseRow } from './acceptance-view';

async function backend(route: string, body: unknown, signal?: AbortSignal) {
  const response = await connectHelix().fetchBackend(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
  if (!response.ok) { const error = await response.json(); throw new Error(error.error ?? `Acceptance request failed (${response.status})`); }
  return response;
}
function EvidenceMedia({ root, item, entry }: { root: string; item: string; entry: CaseRow }) {
  const [media, setMedia] = useState<{ url: string; kind: string; side: string; path: string }[]>([]);
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const abort = new AbortController(), urls: string[] = []; let active = true;
    setMedia([]); setError('');
    if (!entry.latestRun) return () => abort.abort();
    const run = entry.latestRun;
    async function load() {
      try {
        const result = [];
        for (let artifact = 0; artifact < run.artifacts.length; artifact++) {
          const record = run.artifacts[artifact]!;
          const response = await backend('/acceptance/media', { path: root, item, caseId: entry.id, viewport: entry.viewport, runId: run.id, artifact }, abort.signal);
          const blob = await response.blob();
          if (!active) return;
          const url = URL.createObjectURL(blob); urls.push(url);
          result.push({ url, kind: record.kind, side: record.side, path: record.path });
        }
        if (active) setMedia(result);
      } catch (error) { if (active) setError(error instanceof Error ? error.message : String(error)); }
    }
    void load();
    return () => { active = false; abort.abort(); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [root, item, entry]);
  async function playBoth() {
    const players = container.current!.querySelectorAll<HTMLMediaElement>('video,audio');
    try { await Promise.all([...players].map(player => { player.currentTime = 0; return player.play(); })); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }
  return <div ref={container} className="space-y-2">
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {media.some(file => ['video', 'audio'].includes(file.kind)) && <><Button size="xs" variant="outline" onClick={() => void playBoth()}>Play both from start</Button><p className="text-xs text-muted-foreground">Use the recorded event anchors to judge alignment; playback starts are not proof of matched event timing.</p></>}
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{media.map(file => <div key={file.url} className="space-y-1"><p className="text-xs font-semibold">{file.side}</p>{file.kind === 'image' ? <img className="max-h-96 w-full object-contain" src={file.url} alt={`${file.side} ${entry.id} ${entry.viewport}`} onError={() => setError(`Cannot decode image: ${file.path}`)} /> : file.kind === 'video' ? <video controls preload="metadata" className="max-h-96 w-full" src={file.url} /> : file.kind === 'audio' ? <audio controls src={file.url} /> : <a href={file.url} download={file.path.split('/').pop()}>Download observations</a>}<p className="break-all text-xs text-muted-foreground">{file.path}</p></div>)}</div>
  </div>;
}
function ReviewCase({ root, project, item, entry, onSaved }: { root: string; project: string; item: string; entry: CaseRow; onSaved: (report: AcceptanceReport) => void }) {
  const [reviewer, setReviewer] = useState(''), [notes, setNotes] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const eligible = entry.canAccept;
  async function save(status: 'accepted' | 'changes-requested' | 'blocked') {
    if (!entry.latestRun) return;
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await backend('/acceptance/review', { path: root, item, caseId: entry.id, viewport: entry.viewport, runId: entry.latestRun.id, expectedRunSha256: entry.latestRunSha256, supersedes: entry.lastDecision?.id ?? null, reviewer: reviewer.trim(), notes: notes.trim(), status });
      const result = await response.json();
      if (result.status !== 'saved' || result.report.project !== project) throw new Error('Review service did not acknowledge a durable save');
      if (active.current) { setMessage(`Review saved. ${result.publicationError ? 'Dashboard publication failed: ' + result.publicationError : 'Status updated.'}`); onSaved(result.report); }
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (active.current) setBusy(false); }
  }
  return <Section title={`${entry.id} · ${entry.viewport}`} size="sm" variant="card" contentClassName="space-y-3">
    <p className="text-xs">{entry.dimension} · {entry.verification} · Review: {entry.review} · Freshness: {entry.freshness} · Evidence: {entry.availability}</p>
    <p className="text-xs">Basis: {entry.basis.kind} · {entry.basis.source}</p>
    <details className="text-xs"><summary>Capture recipe and event anchors</summary><p>{entry.recipe.setup}</p><p>Reference: {entry.recipe.reference ?? 'Not supplied'}</p><p>Candidate: {entry.recipe.candidate ?? 'Not supplied'}</p><p>Anchors: {entry.recipe.anchors.join(', ')}</p></details>
    <ul className="list-disc space-y-1 pl-4 text-xs">{entry.criteria.map(criterion => <li key={criterion.id}>{criterion.expected}</li>)}</ul>
    {entry.reasons.length > 0 && <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{entry.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    {(entry.priorEvidence || entry.linkedDiscrepancies.length > 0) && <details className="space-y-2 text-xs"><summary>Prior evidence and discrepancy findings</summary><p>Historical findings inform this review; resolved discrepancies do not approve this case. Open retained sources in this entry's catalog evidence list.</p>{entry.priorEvidence && <><p>{entry.priorEvidence.note}</p>{entry.priorEvidence.sources.map(source => <p className="break-all" key={source.path}>{source.available ? 'Local source (not a verified capture)' : 'Missing locally'}: {source.path}</p>)}</>}{entry.linkedDiscrepancies.map(record => <p className="break-all" key={record.id}>{record.id}: <strong>{record.status}</strong> · {record.path}</p>)}</details>}
    {entry.latestRun && <><EvidenceMedia root={root} item={item} entry={entry} /><p className="text-xs">Captured {entry.latestRun.capturedUtc}. {entry.latestRun.notes}</p>{entry.latestRun.observations.map(observation => <p className="text-xs" key={observation.criterion}><strong>{observation.result}: </strong>{observation.note}</p>)}</>}
    {entry.lastDecision && <p className="text-xs">Last decision: {entry.lastDecision.status} by {entry.lastDecision.reviewer.name}, {entry.lastDecision.savedUtc}. {entry.lastDecision.notes}</p>}
    {entry.lastAccepted && <p className="text-xs text-muted-foreground">Historical acceptance: {entry.lastAccepted.reviewer.name}, {entry.lastAccepted.savedUtc}.</p>}
    {entry.latestRun ? <><label className="block text-xs">Reviewer name<Input aria-label="Reviewer name" value={reviewer} onChange={event => setReviewer(event.target.value)} disabled={busy} /></label><label className="block text-xs">Review notes<textarea aria-label="Review notes" className="mt-1 w-full rounded border bg-background p-2" value={notes} onChange={event => setNotes(event.target.value)} disabled={busy} /></label><p className="text-xs text-muted-foreground">Your name is recorded as self-reported. Save writes to the connected checkout; it does not publish Git changes.</p><div className="flex flex-wrap gap-2"><Button size="xs" disabled={busy || !eligible || !reviewer.trim() || !notes.trim()} onClick={() => void save('accepted')}>Accept case</Button><Button size="xs" variant="outline" disabled={busy || !reviewer.trim() || !notes.trim()} onClick={() => void save('changes-requested')}>Needs work</Button><Button size="xs" variant="outline" disabled={busy || !reviewer.trim() || !notes.trim()} onClick={() => void save('blocked')}>Blocked</Button></div></> : <p className="text-xs">No run to review. Capture evidence through this case's adapter first.</p>}
    {message && <p role="status" className="text-xs">{message}</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </Section>;
}
export function AcceptanceMatrix({ root, project, itemId }: { root: string; project: string; itemId?: string }) {
  const [report, setReport] = useState<AcceptanceReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [selected, setSelected] = useState(''), [filter, setFilter] = useState('all');
  useEffect(() => {
    const abort = new AbortController(); let active = true; setBusy(true); setError('');
    async function load() { try { const response = await backend('/acceptance/status', { path: root }, abort.signal); const result = await response.json(); if (result.format !== 'helix-acceptance-status' || result.version !== 1 || result.project !== project) throw new Error('Unsupported acceptance response'); if (active) setReport(result); } catch (error) { if (active) setError(error instanceof Error ? error.message : String(error)); } finally { if (active) setBusy(false); } }
    void load(); return () => { active = false; abort.abort(); };
  }, [root, project, revision]);
  const rows = report ? report.items.filter(item => itemId === undefined || item.id === itemId).flatMap(item => item.cases.map(entry => ({ item, entry, key: JSON.stringify([item.id, entry.id, entry.viewport]) }))) : [];
  const visible = rows.filter(({ entry }) => filter === 'all' || (filter === 'accepted' ? entry.accepted : filter === 'ready' ? entry.canAccept && !entry.accepted : filter === 'prior' ? entry.priorEvidence !== null || entry.linkedDiscrepancies.length > 0 : filter === 'recheck' ? entry.freshness !== 'current' && entry.lastAccepted !== null : entry.verification === 'blocked' || entry.review === 'changes-requested'));
  const selectedRow = rows.find(row => row.key === selected);
  return <Section title="Acceptance case matrix" variant="card" contentClassName="space-y-3">
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh cases</Button><select aria-label="Filter acceptance cases" className="rounded border bg-background px-2 text-xs" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All cases</option><option value="ready">Ready for review</option><option value="accepted">Accepted</option><option value="prior">Has prior evidence / findings</option><option value="recheck">Needs recheck</option><option value="work">Needs work / blocked</option></select></div>
    {busy && <p role="status" className="text-xs">Checking source and evidence…</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {report && <><p className="text-xs">{report.items.filter(item => itemId === undefined || item.id === itemId).reduce((sum, item) => sum + item.accepted, 0)}/{report.items.filter(item => itemId === undefined || item.id === itemId).reduce((sum, item) => sum + item.required, 0)} required cases accepted · {report.variant}</p><div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Case</th><th>Viewport</th><th>Verification</th><th>Prior findings</th><th>Review</th></tr></thead><tbody>{visible.map(({ item, entry, key }) => <tr key={key} className={key === selected ? 'bg-accent' : ''}><td className="p-1"><button className="text-left underline" onClick={() => setSelected(key)}>{item.title} / {entry.id}</button></td><td>{entry.viewport}</td><td>{entry.verification}</td><td>{entry.linkedDiscrepancies.filter(record => record.status === 'resolved').length} resolved · {entry.linkedDiscrepancies.filter(record => record.status !== 'resolved').length} unresolved{entry.priorEvidence ? ' · evidence linked' : ''}</td><td>{entry.accepted ? 'Accepted' : entry.review}{entry.freshness === 'needs-recheck' ? ' · Needs recheck' : ''}</td></tr>)}</tbody></table></div><p className="text-xs text-muted-foreground">Checked {report.assessedUtc}. Connected checkout: {root}. Refresh to detect later changes.</p></>}
    {selectedRow && <ReviewCase key={`${root}:${selectedRow.key}:${selectedRow.entry.latestRun?.id ?? 'none'}`} root={root} project={project} item={selectedRow.item.id} entry={selectedRow.entry} onSaved={setReport} />}
  </Section>;
}
