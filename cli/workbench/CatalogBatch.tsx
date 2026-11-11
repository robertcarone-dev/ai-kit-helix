import { useEffect, useRef, useState } from 'react';
import { Button, connectHelix } from '@helix/kit';
import { Play, RefreshCw, LoaderCircle, CheckCircle2, Wrench, ClipboardCheck, AlertTriangle } from 'lucide-react';
type Selection = { mode: 'ready' | 'changed'; folder?: string; scope: string; discipline: string };
type Plan = { token: string; runnable: number; blocked: number; summary: { checks: number; complete: number; failed: number; review: number; unmeasured: number; missingAdapters: number }; rows: { item: string; title: string; caseId: string; viewport: string; state: string; directAdapter: boolean; supportingEvidence: number }[]; captures: { key: string; item: string; caseId: string; viewport: string; blocker: string | null; supports: unknown[] }[] };
type Batch = { id: string; status: string; message: string | null; selection: Selection; groups: { jobId: string; phase: string; results: { item: string; caseId: string; viewport: string; outcome: string }[] }[] };
async function request(root: string, route: string, input: object, signal: AbortSignal) {
  const response = await connectHelix().fetchBackend('/acceptance/batch-' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: root, ...input }), signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
}
export function CatalogBatch({ root, folder, title, scope, discipline, onFinished }: { root: string; folder?: string; title: string; scope: string; discipline: string; onFinished: () => void }) {
  const [mode, setMode] = useState<'ready' | 'changed'>('ready'), [plan, setPlan] = useState<Plan | null>(null), [batch, setBatch] = useState<Batch | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const callback = useRef(onFinished); callback.current = onFinished;
  const finished = useRef<string | null>(null), owner = useRef<AbortController | null>(null);
  useEffect(() => () => owner.current?.abort(), []);
  const selection: Selection = { mode, scope, discipline, ...(folder ? { folder } : {}) };
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setPlan(null); setError('');
    void request(root, 'plan', { selection: { mode, scope, discipline, ...(folder ? { folder } : {}) } }, abort.signal).then(value => { if (!abort.signal.aborted) setPlan(value); }).catch(error => { if (!abort.signal.aborted) setError(String(error)); });
    const poll = async () => {
      try {
        const current: Batch | null = await request(root, 'status', {}, abort.signal); if (abort.signal.aborted) return; setBatch(current);
        if (current && ['queued', 'running'].includes(current.status)) timer = setTimeout(() => void poll(), 2000);
        else if (current && finished.current !== current.id) { finished.current = current.id; callback.current(); setRevision(value => value + 1); }
      } catch (error) { if (!abort.signal.aborted) setError(String(error)); }
    };
    void poll(); return () => { abort.abort(); clearTimeout(timer); };
  }, [root, folder, scope, discipline, mode, revision]);
  const running = !!batch && ['queued', 'running'].includes(batch.status);
  async function start(resume = false) {
    if (!plan) return;
    const abort = new AbortController(); owner.current?.abort(); owner.current = abort; setBusy(true); setError('');
    try {
      const next = await request(root, 'start', { selection, expectedToken: plan.token, ...(resume && batch ? { resume: batch.id } : {}) }, abort.signal);
      if (!abort.signal.aborted) { setBatch(next); setRevision(value => value + 1); }
    } catch (error) { if (!abort.signal.aborted) setError(String(error)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  const labels: Record<string, string> = { complete: 'Complete', review: 'Review / evaluate criteria', failed: 'Assertion failed', changed: 'Inputs changed', ready: 'Ready to collect', unmeasured: 'Criteria not measured', gates: 'Acceptance gates remain', 'adapter-missing': 'Adapter missing', 'support-only': 'Supporting evidence collected · primary criteria remain' };
  return <section className="wb-panel wb-stack" aria-label="Catalog batch checks">
    <div className="wb-header"><div><h3>{title} checks</h3><p className="wb-small wb-muted">Shared captures run once. Supporting evidence does not complete unmeasured criteria.</p></div><Button variant="outline" disabled={busy || running} onClick={() => setRevision(value => value + 1)} aria-label="Refresh batch plan"><RefreshCw size={16} /></Button></div>
    <div className="wb-toolbar"><Button variant={mode === 'ready' ? 'default' : 'outline'} onClick={() => setMode('ready')}>Ready checks</Button><Button variant={mode === 'changed' ? 'default' : 'outline'} onClick={() => setMode('changed')}>Changed inputs</Button><Button disabled={!plan?.runnable || busy || running} onClick={() => void start()}>{busy || running ? <LoaderCircle size={16} className="wb-spin" /> : <Play size={16} />}{running ? 'Batch running' : mode === 'ready' ? 'Run ready checks' : 'Recheck changed'}</Button>{batch && ['blocked', 'interrupted'].includes(batch.status) && <Button variant="outline" disabled={!plan?.runnable || busy} onClick={() => void start(true)}>Resume unfinished</Button>}</div>
    {plan && <><div className="wb-toolbar wb-small"><span><CheckCircle2 size={15} className="inline" /> {plan.summary.complete}/{plan.summary.checks} complete</span><span><Play size={15} className="inline" /> {plan.runnable} captures ready</span><span><ClipboardCheck size={15} className="inline" /> {plan.summary.review} to review · {plan.summary.unmeasured} need measurements</span><span><Wrench size={15} className="inline" /> {plan.summary.failed} failed</span><span><AlertTriangle size={15} className="inline" /> {plan.summary.missingAdapters} need direct adapters</span></div>
    <details className="wb-tech"><summary>Coverage and setup gaps ({plan.rows.length} checks)</summary><div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Feature / case</th><th>Viewport</th><th>Next step</th></tr></thead><tbody>{plan.rows.map(row => <tr key={`${row.item}:${row.caseId}:${row.viewport}`}><td className="py-2">{row.title}<small className="block wb-muted">{row.caseId}</small></td><td>{row.viewport}</td><td>{labels[row.state]}{!row.directAdapter && row.state !== 'complete' && <small className="block wb-muted">No direct assertion adapter · {row.supportingEvidence} related evidence sources</small>}</td></tr>)}</tbody></table></div>{plan.captures.filter(capture => capture.blocker).map(capture => <p className="wb-small" key={capture.key}>{capture.item} · {capture.caseId} · {capture.viewport}: {capture.blocker}</p>)}</details></>}
    {batch && <div role="status"><strong>{running ? batch.groups.at(-1)?.phase ?? 'Queued' : batch.status === 'needs-review' ? 'Collection finished · review required' : batch.status === 'completed' ? 'Batch finished' : batch.status}</strong><p className="wb-small wb-muted">{batch.groups.reduce((sum, group) => sum + group.results.length, 0)} captures imported</p>{batch.message && <p className="wb-small">{batch.message}</p>}<details className="wb-tech"><summary>Batch results</summary>{batch.groups.flatMap(group => group.results).map(result => <p key={`${result.item}:${result.caseId}:${result.viewport}`}>{result.item} · {result.caseId} · {result.viewport}: {result.outcome === 'unmeasured' ? 'Criteria need evaluation' : result.outcome}</p>)}</details></div>}
    {error && <p role="alert" className="wb-error">{error}</p>}
  </section>;
}
