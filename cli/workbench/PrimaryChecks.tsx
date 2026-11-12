import { AiKitChecks } from './AiKitChecks';
import { useEffect, useState } from 'react';
import { connectHelix } from '@helix/kit';
import { Play } from 'lucide-react';
import { VerificationRun } from './VerificationRun';
import { primaryCases } from './primary-checks-view';
import type { PrimaryCase } from './primary-checks-view';
import { readableCase } from './workbench-presentation';

export function PrimaryChecks({ root, itemId, onSaved }: { root: string; itemId: string; onSaved: () => void }) {
  const [cases, setCases] = useState<PrimaryCase[]>([]), [selected, setSelected] = useState(''), [selectedWorkflow, setSelectedWorkflow] = useState(''), [error, setError] = useState(''), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController(); setError(''); setLoading(true);
    void (async () => {
      try {
        const response = await connectHelix().fetchBackend('/acceptance/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: root }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) });
        const value = await response.json(); if (!response.ok) throw new Error(value.error);
        if (!abort.signal.aborted) { const next = primaryCases(value, itemId); setCases(next); setSelected(previous => next.some(entry => entry.id === previous) ? previous : (next.find(entry => entry.workflows.length > 0) ?? next[0])?.id ?? ''); }
      } catch (error) { if (!abort.signal.aborted) setError(String(error)); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    })();
    return () => abort.abort();
  }, [root, itemId, revision]);
  const selectedCase = cases.find(entry => entry.id === selected);
  const workflow = selectedCase?.workflows.find(entry => entry.id === selectedWorkflow) ?? selectedCase?.workflows[0];
  return <section className="wb-panel wb-stack" aria-label="Run primary checks">
    <div><h3><Play size={16} className="inline" /> Primary checks</h3><p className="wb-muted">{cases.length ? `${cases.length} primary checks. Request AI Kit verification using the declared setup and criteria.` : error ? 'Could not load primary checks.' : loading ? 'Loading primary checks…' : 'No primary checks are defined.'}</p></div>
    {cases.length > 0 && <label className="wb-field">Check<select className="wb-select" aria-label="Primary check to run" value={selected} onChange={event => setSelected(event.target.value)}>{cases.map(entry => <option key={entry.id} value={entry.id}>{readableCase(entry.id)} · {entry.complete}/{entry.viewports.length} complete</option>)}</select></label>}
    {cases.length > 0 && <AiKitChecks root={root} selection={{ item: itemId, caseId: null, remaining: true }} onRefresh={() => { setRevision(value => value + 1); onSaved(); }} />}
    {selectedCase && <details><summary className="wb-small">Request only this check</summary><AiKitChecks root={root} selection={{ item: itemId, caseId: selectedCase.id, remaining: false }} onRefresh={() => { setRevision(value => value + 1); onSaved(); }} /></details>}
    {workflow && <details><summary className="wb-small">Existing capture tools</summary>
    {selectedCase && selectedCase.workflows.length > 1 && <label className="wb-field">Check<select className="wb-select" aria-label="Capture check to run" value={workflow!.id} onChange={event => setSelectedWorkflow(event.target.value)}>{selectedCase.workflows.map(entry => <option key={entry.id} value={entry.id}>{readableCase(entry.caseId)} · {entry.viewports.join(', ')}{entry.supporting ? ' · supporting check' : ''}</option>)}</select></label>}
    {workflow && <><p className="wb-small wb-muted">{workflow.supporting ? 'Supporting check: this collects evidence for part of the scenario; it does not complete the primary case.' : 'Scenario check'} · {workflow.viewports.join(', ')}</p><VerificationRun key={workflow.id} root={root} id={workflow.id} onFinished={() => { setRevision(value => value + 1); onSaved(); }} /></>}
    </details>}
    {selectedCase && !workflow && <p className="wb-small wb-muted">AI Kit uses this case's setup and criteria; no custom capture adapter is required.</p>}
    {error && <p role="alert" className="wb-error">{error}</p>}
  </section>;
}
