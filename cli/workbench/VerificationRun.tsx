import { useEffect, useRef, useState } from 'react';
import { Button, connectHelix } from '@helix/kit';
import { Play, LoaderCircle, CheckCircle2, XCircle, AlertTriangle, Smartphone, Tablet, RefreshCw, Bot } from 'lucide-react';

type Result = { viewport: string; outcome: string; current: boolean; capturedUtc: string | null; observations: { criterion: string; result: string; note: string }[] };
type Execution = { configured: boolean; blocker: string | null; token: string; workflow: { review: string; viewports: string[] }; results: Result[]; job: null | { id: string; status: string; phase: string; message: string | null; results: { viewport: string; outcome: string }[] } };
async function request(root: string, route: string, data: object, signal: AbortSignal) {
  const response = await connectHelix().fetchBackend('/acceptance/verification-' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: root, ...data }), signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
}
export function VerificationRun({ root, id, onFinished }: { root: string; id: string; onFinished: () => void }) {
  const [execution, setExecution] = useState<Execution | null>(null), [error, setError] = useState(''), [starting, setStarting] = useState(false), [revision, setRevision] = useState(0);
  const completed = useRef<string | null>(null), callback = useRef(onFinished); callback.current = onFinished;
  const startOwner = useRef<AbortController | null>(null);
  useEffect(() => () => startOwner.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const next: Execution = await request(root, 'status', { id }, abort.signal); if (abort.signal.aborted) return;
        setExecution(next); setError('');
        if (next.job && ['queued', 'running'].includes(next.job.status)) timer = setTimeout(() => void read(), 2000);
        else if (next.job && completed.current !== next.job.id) { completed.current = next.job.id; callback.current(); }
      } catch (error) { if (!abort.signal.aborted) setError(String(error)); }
    };
    void read(); return () => { abort.abort(); clearTimeout(timer); };
  }, [root, id, revision]);
  async function start() {
    if (!execution) return;
    const abort = new AbortController(); startOwner.current = abort; setStarting(true); setError('');
    try { await request(root, 'start', { id, expectedToken: execution.token }, abort.signal); if (!abort.signal.aborted) setRevision(v => v + 1); }
    catch (error) { if (!abort.signal.aborted) { setError(String(error)); setRevision(v => v + 1); } }
    finally { if (!abort.signal.aborted) setStarting(false); }
  }
  if (execution && !execution.configured) return null;
  const running = starting || !!execution?.job && ['queued', 'running'].includes(execution.job.status);
  const passed = !!execution?.results.length && execution.results.every(result => result.current && result.outcome === 'matched');
  return <section className="wb-verify" aria-label="Automated verification">
    <div className="wb-header"><div><h4><Bot size={18} aria-hidden="true" />Automated checks</h4><p className="wb-small wb-muted">Runs in a dedicated checkout and retains evidence.</p></div><Button disabled={!execution || !!execution.blocker || running} onClick={() => void start()}>{running ? <LoaderCircle size={16} className="wb-spin" /> : <Play size={16} />} {running ? 'Running checks' : 'Run checks'}</Button></div>
    {execution?.job && <p role="status" className={'wb-verify-progress ' + (execution.job.status === 'passed' && passed ? 'wb-tone-accepted' : '')}>{running ? <LoaderCircle size={16} className="wb-spin" /> : execution.job.status === 'passed' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{execution.job.status === 'passed' && !passed ? 'Previous run passed · current evidence needs rechecking' : execution.job.phase}</p>}
    {execution?.job?.message && <details className="wb-tech"><summary>Run blocker details</summary><pre>{execution.job.message}</pre></details>}
    {execution?.blocker && <p className="wb-filter-explanation"><AlertTriangle size={16} />{execution.blocker}</p>}
    {execution?.job && ['blocked', 'interrupted'].includes(execution.job.status) && <p className="wb-small wb-muted">Last completed results are shown below. The latest attempt did not finish.</p>}
    <div className="wb-verify-results">{execution?.results.map(result => {
      const live = execution.job?.results.find(row => row.viewport === result.viewport);
      const state = running ? live ? live.outcome === 'matched' ? 'Passed · finishing' : 'Failed' : 'Pending' : !result.current ? 'Needs rerun' : result.outcome === 'matched' ? 'Passed' : result.outcome === 'mismatch' ? 'Failed' : 'Not measured';
      const Icon = state.startsWith('Passed') ? CheckCircle2 : state === 'Failed' ? XCircle : AlertTriangle;
      const Device = result.viewport === 'tablet' ? Tablet : Smartphone;
      return <div key={result.viewport} className="wb-verify-result"><div><Device size={18} /><strong>{result.viewport}</strong><span className={state.startsWith('Passed') ? 'wb-tone-accepted' : state === 'Failed' ? 'wb-tone-fix' : 'wb-muted'}><Icon size={16} />{state}</span></div>{result.observations.map(observation => <p key={observation.criterion} className="wb-small">{observation.note}</p>)}{result.capturedUtc && <time className="wb-small wb-muted">{new Date(result.capturedUtc).toLocaleString()}</time>}</div>;
    })}</div>
    {execution && <p className="wb-small wb-muted">{execution.workflow.review === 'automated' ? passed && !running ? 'No human review needed for these checks. Art and other feature cases remain separate.' : 'Failures need a fix or rerun. These declared checks do not require manual approval.' : 'Human review is required after collection for this workflow.'}</p>}
    {error && <p role="alert" className="wb-error">{error}</p>}{!running && <Button variant="outline" onClick={() => setRevision(v => v + 1)}><RefreshCw size={14} />Refresh run status</Button>}
  </section>;
}
