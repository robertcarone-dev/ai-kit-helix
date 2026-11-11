import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Button, Input, Tabs, TabsContent, TabsList, TabsTrigger, connectHelix } from '@helix/kit';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, FileSearch, Folder, ExternalLink, Layers, RefreshCw, Wrench } from 'lucide-react';
import { ResolutionWorkflow } from './ResolutionWorkflow';
import { AcceptanceMatrix } from './AcceptanceMatrix';
import { WorkbenchStatus } from './WorkbenchStatus';
import { caseActionText, featureSummary, featureStatus, nextAction, readableCase } from './workbench-presentation';
import type { CatalogFolder, CatalogItem, CatalogReport } from './catalog-view';
import { folderPath, matchesDiscipline } from './catalog-selection';
import './workbench.css';

async function request(route: string, body: unknown, signal: AbortSignal) {
  const response = await connectHelix().fetchBackend(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}
function Evidence({ root, item, specifications = false }: { root: string; item: CatalogItem; specifications?: boolean }) {
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
  return <div className="wb-stack">
    <p className="text-xs text-muted-foreground">{specifications ? 'Optional design context. These documents do not grant acceptance.' : 'Local presence is checked now; recorded hashes are verified when opened. Historical evidence does not establish current parity. Missing files retain their original recovery references.'}</p>
    <div className="max-h-64 overflow-auto space-y-2">{item.evidence.map((artifact, index) => ({ artifact, index })).filter(({ artifact }) => !specifications || artifact.origin === 'specification').map(({ artifact, index }) => <div key={`${artifact.path}:${artifact.sha256}`} className="border-b p-1 text-xs"><p className="break-all">{specifications ? item.specs.find(spec => spec.target === artifact.path)!.title : artifact.path}</p><p>{artifact.origin} · {artifact.availability}</p>{artifact.availability.startsWith('local;') && <Button size="xs" variant="outline" disabled={busy} onClick={() => void open(index)}>{specifications ? 'Read specification' : `Open evidence ${index + 1}`}</Button>}</div>)}</div>
    {!item.evidence.length && <p className="text-xs">No evidence linked yet.</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {preview && <div className="space-y-2"><p className="text-xs break-all">{preview.name}</p>{preview.mime.startsWith('image/') ? <img src={preview.url} alt="Selected catalog evidence" className="max-h-96 object-contain" /> : preview.mime.startsWith('video/') ? <video controls src={preview.url} className="max-h-96" /> : preview.mime.startsWith('audio/') ? <audio controls src={preview.url} /> : preview.text !== null ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{preview.text}</pre> : null}<a className="text-xs underline" href={preview.url} download={preview.name.split('/').pop()}>Download retained file</a></div>}
  </div>;
}
function Issues({ item, query, setQuery, discipline, setDiscipline }: { item: CatalogItem; query: string; setQuery: (value: string) => void; discipline: string; setDiscipline: (value: string) => void }) {
  const [filter, setFilter] = useState(query ? 'all' : 'open'), [page, setPage] = useState(0);
  useEffect(() => { if (item.issues.some(issue => issue.id === query)) { setFilter('all'); setPage(0); } }, [item, query]);
  const issues = item.issues.filter(issue => matchesDiscipline(issue, discipline) && (filter === 'all' || ['open', 'blocked'].includes(issue.status)) && `${issue.id} ${issue.expected} ${issue.observed}`.toLowerCase().includes(query.toLowerCase()));
  const current = Math.min(page, Math.max(0, Math.ceil(issues.length / 8) - 1));
  return <div className="wb-stack">
    <div><h3>Outstanding work</h3><p className="wb-muted">Each finding includes the expected result, the observed difference, and the next step.</p></div>
    <div className="wb-toolbar"><Discipline value={discipline} onChange={setDiscipline} /><Input aria-label="Search findings" placeholder="Search findings…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="wb-search" /><select aria-label="Finding status" className="wb-select" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="open">Open findings</option><option value="all">All findings, including resolved</option></select></div>
    {issues.slice(current * 8, current * 8 + 8).map(issue => <details className="wb-issue" key={issue.id} open={query === issue.id || undefined}><summary>{issue.status === 'resolved' ? <CheckCircle2 size={18} aria-hidden="true" /> : <Wrench size={18} aria-hidden="true" />}<span>{readableCase(issue.id)}<span className="wb-feature-meta">{issue.status === 'accepted-deviation' ? 'Accepted deviation · criterion reconciliation required' : issue.status}</span></span></summary><dl><div><dt>Discipline</dt><dd>{issue.discipline === 'ta' ? 'TA' : issue.discipline === 'dev' ? 'Dev' : issue.discipline === 'shared' ? 'Dev + TA' : 'Unassigned'}</dd></div><div><dt>Expected</dt><dd>{issue.expected}</dd></div><div><dt>Observed</dt><dd>{issue.observed}</dd></div><div><dt>Next step</dt><dd>{issue.nextAction ?? 'Review the retained resolution against the current acceptance criteria.'}</dd></div></dl><details className="wb-tech" style={{ marginTop: 16 }}><summary>Record details</summary><p className="wb-path">{issue.id} · revision {issue.revision}<br />{issue.path}</p></details></details>)}
    {!issues.length && <div className="wb-empty"><CheckCircle2 size={26} aria-hidden="true" /><h3>No findings in this view</h3><p className="wb-muted">Evidence and acceptance requirements are tracked separately in Review.</p></div>}
    {issues.length > 8 && <div className="wb-pagination"><span className="wb-muted">{current * 8 + 1}–{Math.min((current + 1) * 8, issues.length)} of {issues.length} findings</span><div className="flex gap-2"><Button variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous findings"><ChevronLeft size={16} /></Button><Button variant="outline" disabled={(current + 1) * 8 >= issues.length} onClick={() => setPage(current + 1)} aria-label="Next findings"><ChevronRight size={16} /></Button></div></div>}
  </div>;
}
function FeatureDetails({ root, project, item, onBack, onRefresh, renderComparisons, folders, discipline, setDiscipline }: { folders: CatalogFolder[]; discipline: string; setDiscipline: (value: string) => void; root: string; project: string; item: CatalogItem; onBack: () => void; onRefresh: () => void; renderComparisons: (item: CatalogItem) => ReactNode }) {
  const [tab, setTab] = useState('overview'), [issueQuery, setIssueQuery] = useState(''), [caseFilter, setCaseFilter] = useState('captured');
  const status = featureStatus(item), coverage = item.acceptance, open = item.issues.filter(issue => ['open', 'blocked'].includes(issue.status)).length;
  function reviewCases(filter: string) { setCaseFilter(filter); setTab('review'); }
  return <div className="wb-stack">
    <div className="wb-header"><Button variant="ghost" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Close details</Button><Button variant="outline" onClick={onRefresh}><RefreshCw size={16} aria-hidden="true" />Refresh feature</Button></div>
    <header className="wb-header"><div><p className="wb-small wb-muted">{folderPath(folders, item.folder).map(folder => folder.title).join(' / ') || item.group} / {item.kind}</p><h2>{item.title.replace(/ \([^)]*\)$/, '')}</h2></div><WorkbenchStatus status={status} /></header>
    <Tabs value={tab} onValueChange={value => setTab(String(value))}>
      <TabsList className="wb-tabs" aria-label="Feature views"><TabsTrigger value="overview"><Layers size={16} aria-hidden="true" />Overview</TabsTrigger><TabsTrigger value="review"><ClipboardCheck size={16} aria-hidden="true" />Review</TabsTrigger><TabsTrigger value="work"><Wrench size={16} aria-hidden="true" />Work{open > 0 && <Badge variant="secondary">{open}</Badge>}</TabsTrigger></TabsList>
      <TabsContent value="overview" className="wb-stack mt-4"><ResolutionWorkflow root={root} item={item.id} onSaved={onRefresh} onOpen={() => setTab('work')} />
        <section className="wb-attention" aria-label="Feature next steps"><div className="wb-section-heading"><h3>Next steps</h3><span className="wb-small wb-muted">{coverage ? `${coverage.accepted} / ${coverage.required} required checks accepted` : 'Acceptance coverage not defined'}</span></div>
          {open > 0 && <button className="wb-action-row" onClick={() => setTab('work')}><Wrench size={18} className="wb-tone-fix" /><span><strong>Review recorded findings</strong><small>Open records can include pending integration or verification. Their status alone does not prove the current build is broken.</small></span><span className="wb-action-count">{open}</span><ChevronRight size={16} /></button>}
          {coverage && Object.entries(coverage.nextSteps).filter(([action]) => action !== 'accepted' && action !== 'verified').map(([action, count]) => { const copy = caseActionText[action as keyof typeof caseActionText]; return <button className="wb-action-row" key={action} onClick={() => reviewCases(action)}><ClipboardCheck size={18} className="wb-muted" /><span><strong>{copy.title}</strong><small>{copy.detail}</small></span><span className="wb-action-count">{count}</span><ChevronRight size={16} /></button>; })}
          {!coverage && <p className="wb-muted">Define acceptance cases to establish what must be verified.</p>}
          {coverage && <p className="wb-footnote">Counts group required case / viewport checks by their next prerequisite. A check may have additional blockers.</p>}
        </section>
        {item.acceptanceItem !== null ? <AcceptanceMatrix key={item.acceptanceItem} root={root} project={project} itemId={item.acceptanceItem} preview /> : <section className="wb-panel"><h3>Screenshots</h3><p className="wb-muted">No acceptance captures linked to this feature.</p></section>}
        <details className="wb-tech"><summary>Feature scope</summary><p>{item.summary}</p></details>
        <details className="wb-tech"><summary>Specifications</summary><div className="wb-stack">{item.specs.length === 0 ? <p className="wb-muted">No specification linked. Specifications are optional.</p> : <>{item.specs.filter(spec => spec.kind === 'confluence').map(spec => <a className="underline" key={spec.target} href={spec.target} target="_blank" rel="noreferrer">{spec.title}<ExternalLink size={14} aria-hidden="true" className="inline ml-2" /></a>)}{item.specs.some(spec => spec.kind === 'markdown') && <Evidence root={root} item={item} specifications />}</>}</div></details>
        {coverage && coverage.verified > 0 && <div className="wb-callout"><strong>{coverage.verified} captured case findings matched.</strong><p className="wb-muted">These are historical assessments. Review shows whether each capture is current and eligible for acceptance.</p></div>}
        <details className="wb-tech"><summary>Sources and technical details</summary><p>{item.implementation}</p>{item.missingSources.map(path => <p className="wb-path wb-error" key={path}>Missing source: {path}</p>)}{[...new Set([...item.sources, ...item.implementationReferences])].map(path => <p key={path} className="wb-path">{path}</p>)}{item.legacy && <p className="wb-muted">Historical report ({item.legacy.reportedUtc}): {item.legacy.summary}</p>}<p className="wb-path">Feature ID: {item.id}</p></details>
      </TabsContent>
      <TabsContent value="review" className="wb-stack mt-4">{item.acceptanceItem !== null ? <AcceptanceMatrix key={caseFilter} initialFilter={caseFilter} root={root} project={project} itemId={item.acceptanceItem} onSaved={onRefresh} onIssue={id => { setIssueQuery(id); setDiscipline('all'); setTab('work'); }} /> : <div className="wb-empty"><FileSearch size={26} aria-hidden="true" /><h3>Define review coverage</h3><p>Add scoped acceptance cases before requesting human approval.</p></div>}<details className="wb-tech"><summary>Comparison tools and historical evidence ({item.evidence.length} files)</summary><div className="wb-stack">{renderComparisons(item)}<Evidence root={root} item={item} /></div></details></TabsContent>
      <TabsContent value="work" className="wb-stack mt-4"><ResolutionWorkflow root={root} item={item.id} onSaved={onRefresh} /><Issues discipline={discipline} setDiscipline={setDiscipline} item={item} query={issueQuery} setQuery={setIssueQuery} /></TabsContent>
    </Tabs>
  </div>;
}
function Discipline({ value, onChange, label = 'Work discipline' }: { value: string; onChange: (value: string) => void; label?: string }) {
  return <select className="wb-select" aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="all">All disciplines</option><option value="dev">Dev (includes shared)</option><option value="ta">TA (includes shared)</option><option value="shared">Shared Dev + TA</option><option value="unassigned">Unassigned</option></select>;
}
function FeatureTree({ folders, entries, selected, onSelect, reveal = false, parent = null }: { reveal?: boolean; folders: CatalogFolder[]; entries: CatalogItem[]; selected: string; onSelect: (id: string) => void; parent?: string | null }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(reveal ? [] : folders.filter(folder => folder.parent !== null).map(folder => folder.id)));
  return <ul className="wb-tree">{folders.filter(folder => folder.parent === parent).map(folder => {
    const descendants = entries.filter(entry => folderPath(folders, entry.folder).some(value => value.id === folder.id));
    if (!descendants.length) return null;
    const fixes = descendants.filter(entry => featureStatus(entry) === 'fix').length, ready = descendants.filter(entry => featureStatus(entry) === 'ready').length;
    const evidence = descendants.filter(entry => ['evidence', 'define', 'recheck'].includes(featureStatus(entry))).length, accepted = descendants.filter(entry => featureStatus(entry) === 'accepted').length;
    const expanded = !collapsed.has(folder.id);
    return <li key={folder.id}><button className="wb-tree-folder" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${folder.title}`} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next; })}><ChevronRight size={14} aria-hidden="true" style={{ transform: expanded ? 'rotate(90deg)' : undefined }} /><Folder size={17} aria-hidden="true" /><span className="wb-tree-name">{folder.title}</span><span className="wb-tree-total">{descendants.length}</span>{fixes > 0 && <span className="wb-tree-count wb-tone-fix" title={`${fixes} features have open findings`} aria-label={`${fixes} features have open findings`}><Wrench size={12} aria-hidden="true" />{fixes}</span>}{evidence > 0 && <span className="wb-tree-count wb-tone-evidence" title={`${evidence} features need evidence`} aria-label={`${evidence} features need evidence`}><FileSearch size={12} aria-hidden="true" />{evidence}</span>}{accepted > 0 && <span className="wb-tree-count wb-tone-accepted" title={`${accepted} features complete`} aria-label={`${accepted} features complete`}><CheckCircle2 size={12} aria-hidden="true" />{accepted}</span>}{ready > 0 && <span className="wb-tree-count wb-tone-ready" title={`${ready} features ready for review`} aria-label={`${ready} features ready for review`}><ClipboardCheck size={12} aria-hidden="true" />{ready}</span>}</button>{expanded && <FeatureTree folders={folders} entries={entries} selected={selected} onSelect={onSelect} reveal={reveal} parent={folder.id} />}</li>;
  })}{entries.filter(entry => entry.folder === parent).map(entry => {
    const status = featureStatus(entry), Icon = status === 'fix' ? Wrench : status === 'ready' ? ClipboardCheck : status === 'accepted' ? CheckCircle2 : FileSearch;
    return <li key={entry.id}><button className={`wb-tree-feature wb-tone-${status}`} aria-label={`Open ${entry.title}`} aria-current={selected === entry.id ? 'page' : undefined} onClick={() => onSelect(entry.id)}><Icon size={16} aria-hidden="true" /><span className="wb-tree-name"><span className="wb-tree-title">{entry.title.replace(/ \([^)]*\)$/, '')}</span><small>{featureSummary(entry)}</small></span><span className={`wb-tree-dot wb-tone-${status}`} title={nextAction[status]} /><ChevronRight className="wb-tree-open" size={14} aria-hidden="true" /></button></li>;
  })}</ul>;
}
export function GameCatalog({ root, project, renderComparisons }: { root: string; project: string; renderComparisons: (item: CatalogItem) => ReactNode }) {
  const [report, setReport] = useState<CatalogReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [query, setQuery] = useState(''), [scope, setScope] = useState('game'), [filter, setFilter] = useState('all'), [selected, setSelected] = useState(''), [discipline, setDiscipline] = useState('all');
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError('');
    void (async () => { try { const response = await request('/acceptance/catalog', { path: root }, abort.signal); const result = await response.json(); if (result.format !== 'helix-game-catalog' || result.project !== project) throw new Error('Unsupported catalog response'); if (!abort.signal.aborted) setReport(result); } catch (error) { if (!abort.signal.aborted) setError(String(error)); } finally { if (!abort.signal.aborted) setBusy(false); } })();
    return () => abort.abort();
  }, [root, project, revision]);
  const entries = report?.entries ?? [], folders = report?.folders ?? [];
  const scoped = entries.filter(item => (scope === 'all' || item.scope === scope) && (discipline === 'all' || item.issues.some(issue => ['open', 'blocked'].includes(issue.status) && matchesDiscipline(issue, discipline))));
  const visible = scoped.filter(item => `${item.title} ${item.id} ${folderPath(folders, item.folder).map(folder => folder.title).join(' ')}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || featureStatus(item) === filter));
  const detail = useRef<HTMLElement>(null);
  const active = entries.find(item => item.id === selected);
  return <div className="porting-workbench wb-panel wb-stack wb-catalog">
    <header className="wb-header"><h2>Features</h2><Button variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Refresh</Button></header>
    {error && <p role="alert" className="wb-error">{error}</p>}{busy && <p role="status" className="wb-small wb-muted">Refreshing features and evidence…</p>}
    <div className="wb-tree-layout"><aside className="wb-tree-sidebar"><div className="wb-tree-tools"><Input aria-label="Search features" placeholder="Find a feature or folder…" value={query} onChange={event => setQuery(event.target.value)} /><div className="wb-tree-filters"><select aria-label="Feature status" className="wb-select" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option><option value="fix">Open findings</option><option value="evidence">Verification incomplete</option><option value="ready">Ready for review</option><option value="accepted">Complete</option><option value="define">Define coverage</option></select><Discipline label="Filter feature work by discipline" value={discipline} onChange={setDiscipline} /></div><select aria-label="Catalog scope" className="wb-select" value={scope} onChange={event => setScope(event.target.value)}><option value="game">Game features</option><option value="all">Include tools and variants</option></select></div>
    <div className="wb-tree-legend"><span className="wb-tone-fix"><Wrench size={13} />Findings</span><span className="wb-tone-evidence"><FileSearch size={13} />Evidence</span><span className="wb-tone-ready"><ClipboardCheck size={13} />Review</span><span className="wb-tone-accepted"><CheckCircle2 size={13} />Complete</span></div>
    <nav aria-label="Feature hierarchy"><FeatureTree key={`${query}:${filter}:${discipline}:${scope}`} reveal={query.length > 0 || filter !== 'all' || discipline !== 'all'} folders={folders} entries={visible} selected={selected} onSelect={id => { setSelected(id); detail.current!.scrollIntoView({ block: 'nearest' }); }} /></nav>{!visible.length && !busy && <p className="wb-muted wb-tree-empty">No matching features. Try another filter.</p>}</aside>
    <main className="wb-feature-detail" ref={detail}>{active ? <FeatureDetails folders={folders} discipline={discipline} setDiscipline={setDiscipline} key={`${root}:${active.id}`} root={root} project={project} item={active} onBack={() => setSelected('')} onRefresh={() => setRevision(value => value + 1)} renderComparisons={renderComparisons} /> : <div className="wb-tree-welcome"><h3>No feature selected</h3><p className="wb-muted">Select a feature to view its evidence and findings.</p><div className="wb-tree-summary">{[['fix', 'with open findings', Wrench], ['evidence', 'not yet verified', FileSearch], ['ready', 'ready for review', ClipboardCheck]].map(([status, label, Icon]) => { const Symbol = Icon as typeof Wrench; return <button key={status as string} className={`wb-summary-chip wb-tone-${status}`} onClick={() => setFilter(status as string)}><Symbol size={18} /><strong>{scoped.filter(entry => featureStatus(entry) === status).length}</strong>{label as string}</button>; })}</div><p className="wb-small wb-muted">Status reflects declared acceptance coverage, not estimated game completion.</p></div>}</main></div>
    {report && <details className="wb-tech"><summary>Catalog diagnostics</summary><p>{report.summary.game} game features · {report.summary.accepted} completed scopes</p>{report.warnings.map(warning => <p key={warning} className="wb-error">{warning}</p>)}{report.unmappedDiscrepancies.length > 0 && <p className="wb-path">Unmapped findings: {report.unmappedDiscrepancies.join(', ')}</p>}<p className="wb-path">{root}</p><p>Product exclusions: {report.exclusions.length}</p><ul>{report.exclusions.map(value => <li key={value}>{value}</li>)}</ul>{report.unmappedComparisons.length > 0 && <p>{report.unmappedComparisons.length} comparisons need feature links.</p>}</details>}
  </div>;
}
