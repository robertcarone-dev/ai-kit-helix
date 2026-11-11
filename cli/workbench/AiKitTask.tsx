import { useEffect, useRef, useState } from 'react';
import { Button, connectHelix } from '@helix/kit';
import { Send, Paperclip, CheckCircle2, AlertTriangle } from 'lucide-react';
type TaskTarget = { item: string; kind: 'finding' | 'tooling'; finding?: string };
type TaskPlan = { token: string; title: string; body: string; attachments: { path: string; status: string }[]; specs: { title: string; target: string; kind: string }[]; blocker: string | null; receipt: null | { status: string; messageId: string | null; error: string | null } };
export function AiKitTask({ root, target, label = 'Create AI Kit task' }: { root: string; target: TaskTarget; label?: string }) {
  const [plan, setPlan] = useState<TaskPlan | null>(null), [busy, setBusy] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState(''), [open, setOpen] = useState(false);
  const owner = useRef<AbortController | null>(null);
  useEffect(() => () => owner.current?.abort(), []);
  async function request(submit: boolean) {
    const abort = new AbortController(); owner.current?.abort(); owner.current = abort; setBusy(true); setSending(submit); setError('');
    try {
      const response = await connectHelix().fetchBackend('/acceptance/task-' + (submit ? 'submit' : 'preview'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: root, target, ...(submit ? { expectedToken: plan!.token } : {}) }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error);
      if (!abort.signal.aborted) { if (submit) setPlan(previous => ({ ...previous!, receipt: value })); else setPlan(value); setOpen(true); }
    } catch (error) { if (!abort.signal.aborted) setError(String(error)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  return <section className="wb-task-request">
    <Button variant="outline" disabled={busy} onClick={() => void request(false)}><Send size={15} />{busy ? sending ? 'Submitting…' : 'Preparing task…' : label}</Button>
    {error && <p role="alert" className="wb-error">{error}</p>}
    {open && plan && <div className="wb-task-preview">
      <div className="wb-header"><h3>{plan.title}</h3><Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Close preview</Button></div>
      <p className="wb-small wb-muted">Sends a scoped request to the PM in this project. It includes existing specs and evidence; no Unity runs or captures are requested.</p>
      {plan.receipt ? <div role="status" className="wb-callout">{plan.receipt.status === 'sent' ? <><CheckCircle2 size={18} /><strong>Sent to AI Kit PM</strong><p className="wb-small">Message {plan.receipt.messageId}. Check AI Kit for the resulting board task.</p></> : <><AlertTriangle size={18} /><strong>{plan.receipt.status === 'pending' ? 'Submission pending' : 'Delivery needs checking'}</strong><p>Check the AI Kit chat before sending again. This request will not be retried automatically.</p><p className="wb-small">{plan.receipt.error}</p></>}</div> : <>
        <details className="wb-tech"><summary>Task description</summary><pre className="wb-task-body">{plan.body}</pre></details>
        <details className="wb-tech"><summary><Paperclip size={14} className="inline" /> {plan.attachments.filter(file => file.status === 'available').length} local attachments · {plan.specs.filter(spec => spec.kind === 'confluence').length} linked specs</summary><ul>{plan.attachments.map(file => <li className="wb-path" key={file.path}>{file.path} · {file.status}</li>)}{plan.specs.filter(spec => spec.kind === 'confluence').map(spec => <li key={spec.target}><a href={spec.target} target="_blank" rel="noreferrer">{spec.title}</a></li>)}</ul></details>
        {plan.attachments.some(file => file.status !== 'available') && <p className="wb-small">Missing or changed files are listed in the task, not attached as verified evidence.</p>}
        {plan.blocker && <p role="alert" className="wb-error">{plan.blocker}</p>}
        <Button disabled={busy || plan.blocker !== null} onClick={() => void request(true)}><Send size={15} />{busy ? 'Submitting…' : 'Submit to AI Kit PM'}</Button>
      </>}
    </div>}
  </section>;
}
