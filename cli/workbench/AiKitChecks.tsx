import { useEffect, useRef, useState } from 'react';
import { Button, connectHelix } from '@helix/kit';
import { Play, RefreshCw, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
type Selection = { item: string | null; caseId: string | null; remaining: boolean };
type Plan = { token: string; title: string; scenarioCount: number; viewportCount: number; blocker: string | null; receipt: null | { status: string; messageId: string | null; error: string | null }; checks: { item: string; caseId: string; viewports: { id: string; verification: string; complete: boolean }[] }[]; deferred: { item: string; caseId: string; reason: string }[] };
export function AiKitChecks({ root, selection, onRefresh }: { root: string; selection: Selection; onRefresh: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const owner = useRef<AbortController | null>(null);
  useEffect(() => { setPlan(null); setError(''); setBusy(false); return () => owner.current?.abort(); }, [root, selection.item, selection.caseId, selection.remaining]);
  async function request(start: boolean) {
    const abort = new AbortController(); owner.current?.abort(); owner.current = abort; setBusy(true); setError('');
    try {
      const response = await connectHelix().fetchBackend('/acceptance/aikit-checks-' + (start ? 'start' : 'plan'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: root, selection, ...(start ? { expectedToken: plan!.token } : {}) }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      if (!abort.signal.aborted) { if (start) setPlan(previous => ({ ...previous!, receipt: result })); else { setPlan(result); onRefresh(); } }
    } catch (error) { if (!abort.signal.aborted) setError(String(error)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  return <section className="wb-stack" aria-label="AI Kit verification request">
    <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void request(false)}>{plan ? <RefreshCw size={15} /> : <Play size={15} />}{busy ? 'Working…' : plan ? 'Refresh AI Kit checks' : selection.item === null ? 'Preview remaining AI Kit checks' : 'Preview AI Kit checks'}</Button></div>
    {error && <p role="alert" className="wb-error">{error}</p>}
    {plan && <div className="wb-stack">
      <p>{plan.scenarioCount} scenarios · {plan.viewportCount} viewport checks</p>
      <p className="wb-small wb-muted">Send a verification request to AI Kit. Track execution in AI Kit. Integrated evidence appears in the existing review panel. A request or completed task does not verify a case.</p>
      {plan.deferred.map(entry => <p key={entry.item + entry.caseId} className="wb-small"><Clock size={14} className="inline" /> {entry.item} / {entry.caseId}: {entry.reason}</p>)}
      {plan.blocker && <p role="status" className={plan.scenarioCount === 0 ? "wb-small wb-muted" : "wb-error"}>{plan.blocker}</p>}
      {plan.receipt ? <p role="status" className="wb-small">{plan.receipt.status === 'sent' ? <Clock size={15} className="inline" /> : <AlertTriangle size={15} className="inline" />} {plan.receipt.status === 'sent' ? 'Requested in AI Kit' : 'Submission needs inspection'}{plan.receipt.messageId ? ' · ' + plan.receipt.messageId : ''}{plan.receipt.error ? ' · ' + plan.receipt.error : ''}</p> : plan.scenarioCount > 0 ? <Button disabled={busy || plan.blocker !== null} onClick={() => void request(true)}><Play size={15} />Request {plan.scenarioCount} scenarios in AI Kit</Button> : null}
      <details><summary className="wb-small">Selected cases and current results</summary><table className="w-full text-xs"><thead><tr><th>Scenario</th><th>Current verification</th></tr></thead><tbody>{plan.checks.map(entry => <tr key={entry.item + entry.caseId}><td>{entry.item} / {entry.caseId}</td><td>{entry.viewports.map(viewport => <span key={viewport.id} className="mr-2">{viewport.complete ? <CheckCircle2 size={13} className="inline" /> : <Clock size={13} className="inline" />} {viewport.id}: {viewport.verification}</span>)}</td></tr>)}</tbody></table></details>
    </div>}
  </section>;
}
