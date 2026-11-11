import { VerificationRun } from './VerificationRun';
import { useEffect, useRef, useState } from 'react';
import { Button, Input, Textarea, connectHelix } from '@helix/kit';
import { CheckCircle2, GitCommitHorizontal, FileCheck2, ClipboardCheck, RefreshCw } from 'lucide-react';
import type { ResolutionFinding } from './resolution-view';

async function request(root: string, route: string, data: object, signal?: AbortSignal) {
  const response = await connectHelix().fetchBackend('/acceptance/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: root, ...data }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}
const labels: Record<string, string> = { integrated: 'Integrated', 'integration-pending': 'Integration pending', 'fix-not-linked': 'Fix not linked', 'not-recorded': 'No evidence', 'recovery-needed': 'Recover evidence', 'provenance-incomplete': 'Input coverage missing', 'stale-inputs': 'Inputs changed', 'ready-for-review': 'Current evidence', pending: 'Open', blocked: 'Blocked', 'resolved-recorded': 'Resolved', 'deviation-recorded': 'Deviation recorded' };
function Finding({ root, finding, onSaved, onOpen }: { onOpen?: () => void; root: string; finding: ResolutionFinding; onSaved: () => void }) {
  const [reviewer, setReviewer] = useState(''), [notes, setNotes] = useState(''), [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ url: string; text: string | null } | null>(null), [plans, setPlans] = useState<any[] | null>(null);
  const owner = useRef<AbortController | null>(null), url = useRef<string | null>(null), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; owner.current?.abort(); if (url.current) URL.revokeObjectURL(url.current); }; }, []);
  useEffect(() => { owner.current?.abort(); if (url.current) { URL.revokeObjectURL(url.current); url.current = null; } setPreview(null); setAck(false); }, [finding.token]);
  async function inspect(index: number) {
    owner.current?.abort(); const abort = new AbortController(); owner.current = abort; setError('');
    try {
      const response = await request(root, 'resolution-media', { id: finding.definition.id, expectedToken: finding.token, artifact: index }, abort.signal);
      const blob = await response.blob(), text = blob.type === 'text/plain' ? await blob.text() : null;
      if (abort.signal.aborted) return;
      if (url.current) URL.revokeObjectURL(url.current); url.current = URL.createObjectURL(blob); setPreview({ url: url.current, text });
    } catch (error) { if (!abort.signal.aborted) setError(String(error)); }
  }
  async function plan() {
    owner.current?.abort(); const abort = new AbortController(); owner.current = abort; setError(''); setBusy(true);
    try { const response = await request(root, 'resolution-plan', { id: finding.definition.id, expectedToken: finding.token }, abort.signal); const value = await response.json(); if (!abort.signal.aborted) setPlans(value.plans); }
    catch (error) { if (!abort.signal.aborted) setError(String(error)); } finally { if (!abort.signal.aborted) setBusy(false); }
  }
  async function save(action: string) {
    setBusy(true); setError(''); setMessage('');
    try { const response = await request(root, 'resolution-review', { review: { id: finding.definition.id, expectedToken: finding.token, reviewer, notes, action, evidenceReviewed: ack } }); const value = await response.json(); if (value.status !== 'saved') throw new Error('Review was not acknowledged as saved'); if (active.current) { setMessage(`Saved discrepancy revision ${value.receipt.revision}. Feature acceptance is unchanged.`); setAck(false); setNotes(''); onSaved(); } }
    catch (error) { if (active.current) setError(String(error)); } finally { if (active.current) setBusy(false); }
  }
  const terminal = ['resolved-recorded', 'deviation-recorded'].includes(finding.review);
  return <section className="wb-resolution wb-stack" aria-label={`Resolution: ${finding.definition.title}`}>
    <header className="wb-header"><div><h3>{finding.definition.title}</h3><p className="wb-small wb-muted">{finding.assignment ?? 'Unassigned'} · discrepancy revision {finding.revision}</p></div><Button variant="outline" disabled={busy} onClick={onSaved}><RefreshCw size={14} />Check again</Button></header>
    <div className="wb-resolution-tracks">
      <div><GitCommitHorizontal size={18} /><span>Implementation<strong className={finding.implementation === 'integrated' ? 'wb-tone-accepted' : ''}>{labels[finding.implementation]}</strong></span></div>
      <div><FileCheck2 size={18} /><span>Evidence<strong>{labels[finding.evidence]}</strong></span></div>
      <div><ClipboardCheck size={18} /><span>Finding<strong>{labels[finding.review]}</strong></span></div>
    </div>
    {onOpen ? <Button variant="outline" onClick={onOpen}>Open finding workflow</Button> : <><p>{finding.expected}</p>
    <VerificationRun root={root} id={finding.definition.id} onFinished={onSaved} />
    {finding.nextAction && <div className="wb-filter-explanation"><strong>Verification step</strong><p>{finding.nextAction}</p></div>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void plan()}>Prepare verification plan</Button><span className="wb-small wb-muted">Read-only; does not launch a capture.</span></div>
    {plans && <details className="wb-tech" open><summary>Verification plan ({plans.length} viewports)</summary>{plans.map(plan => <div key={plan.viewport}><strong>{plan.viewport} · {plan.captureAvailable ? 'Capture adapter configured' : 'Capture adapter missing'}</strong><ul>{plan.blockers.map((blocker: string) => <li key={blocker}>{blocker}</li>)}</ul><pre>{`Tools/Helix/bin/helix acceptance plan --item ${plan.item} --case ${plan.caseId} --viewport ${plan.viewport} --out .aikit/scratch/NEW_REVIEW/${plan.viewport}`}</pre></div>)}</details>}
    <details className="wb-tech"><summary>Integrated commits and evidence ({finding.artifacts.length} files)</summary><div className="wb-stack">{finding.integration.map(commit => <p key={commit.commit} className="wb-path">{commit.commit} · {commit.state}</p>)}{finding.artifacts.map(artifact => <div key={artifact.index}><p>{artifact.claim}</p><p className="wb-small wb-muted">{artifact.status}</p><Button variant="outline" disabled={busy || artifact.status !== 'intact'} onClick={() => void inspect(artifact.index)}>Inspect evidence {artifact.index + 1}</Button></div>)}{preview && (preview.text !== null ? <pre>{preview.text}</pre> : <a href={preview.url} target="_blank" rel="noreferrer"><img className="wb-resolution-image" src={preview.url} alt="Retained finding evidence" /></a>)}<details><summary>Declared input checks ({finding.inputs.filter(input => input.status !== 'intact').length} need attention)</summary>{finding.inputs.map(input => <p className="wb-path" key={input.path}>{input.status} · {input.path}</p>)}</details></div></details>
    <details className="wb-tech"><summary>Review finding</summary><div className="wb-stack">{finding.decision && <p>Recorded decision: {finding.decision}</p>}{finding.resolutionReview && <p className="wb-small wb-muted">{finding.resolutionReview.action} · {finding.resolutionReview.reviewer} · {finding.resolutionReview.savedUtc}</p>}{finding.blockers.length > 0 && <ul>{finding.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}<label className="wb-field">Reviewer name<Input aria-label="Finding reviewer" value={reviewer} disabled={busy} onChange={event => setReviewer(event.target.value)} /></label><label className="wb-field">Review notes<Textarea aria-label="Finding review notes" value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} /></label><label className="wb-resolution-ack"><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)} />I reviewed the evidence against this finding’s stated scope.</label><div className="flex flex-wrap gap-2">{terminal ? <Button disabled={busy || !reviewer.trim() || !notes.trim()} onClick={() => void save('reopen')}>Reopen finding</Button> : <><Button disabled={busy || !finding.canResolve || !ack || !reviewer.trim() || !notes.trim()} onClick={() => void save('resolve')}><CheckCircle2 size={16} />Resolve finding</Button><Button variant="outline" disabled={busy || !reviewer.trim() || !notes.trim()} onClick={() => void save('request-changes')}>Request changes</Button><Button variant="outline" disabled={busy || !reviewer.trim() || !notes.trim()} onClick={() => void save('block')}>Record blocker</Button></>}</div><p className="wb-small wb-muted">Self-reported identity. Saves a new discrepancy revision in this checkout; does not publish or change acceptance decisions.</p></div></details>
    </>}{message && <p role="status">{message}</p>}{error && <p role="alert" className="wb-error">{error}</p>}
  </section>;
}
export function ResolutionWorkflow({ root, item, onSaved, onOpen }: { root: string; item: string; onSaved: () => void; onOpen?: () => void }) {
  const [findings, setFindings] = useState<ResolutionFinding[]>([]), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => { const abort = new AbortController(); setError(''); void (async () => { try { const response = await request(root, 'resolutions', { item }, abort.signal); const result = await response.json(); if (!abort.signal.aborted) setFindings(result.findings); } catch (error) { if (!abort.signal.aborted) setError(String(error)); } })(); return () => abort.abort(); }, [root, item, revision]);
  return <>{error && <p role="alert" className="wb-error">{error}</p>}{findings.map(finding => <Finding onOpen={onOpen} key={finding.definition.id} root={root} finding={finding} onSaved={() => { setRevision(value => value + 1); onSaved(); }} />)}</>;
}
