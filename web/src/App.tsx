import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, BadgeCheck, Banknote, Check, ChevronDown,
  CircleHelp, CirclePlay, FileChartColumn, FileText, Fingerprint,
  FolderClock, LockKeyhole, LogOut, MoreHorizontal, RotateCw,
  Search, ShieldCheck, UploadCloud, X,
} from 'lucide-react'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
type Decision = 'eligible' | 'ineligible' | 'review'
type Run = {
  run_id: string; status: string; row_count: number; duplicate_email_count: number
  matched_count: number; unmatched_count: number; review_count: number; created_at: string
}
type Product = {
  product_id: string; lender: string; product_name: string; product_url: string
  observed_at: string | null; extraction_status: string | null
}
type PendingPolicy = {
  snapshot_id: string; product_id: string; lender: string; product_name: string
  source_url: string; observed_at: string; rules: Record<string, { kind: string; status?: string; min?: number; max?: number; currency?: string; location_dependent?: boolean }>
  source_excerpt: string; model_provider: string; model_name: string; reviewer_note: string
}
type Dashboard = { runs: Run[]; total_runs: number; total_rows: number; pending_events: number; products: Product[]; storage_mode: 's3' | 'local'; max_upload_bytes: number }
type Match = {
  result_id: string; user_id: string; product_id: string; lender: string; product_name: string
  decision: Decision; reasons: { criterion: string; status: string; minimum?: number; maximum?: number; message?: string }[]
}

const fmt = (value: number) => new Intl.NumberFormat('en-IN').format(value || 0)
const relative = (value: string) => {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('clickpe-operator-token') || '')
  const [draftToken, setDraftToken] = useState('')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [pendingPolicies, setPendingPolicies] = useState<PendingPolicy[]>([])
  const [selectedRun, setSelectedRun] = useState<Run | null>(null)
  const [results, setResults] = useState<Match[]>([])
  const [totalResults, setTotalResults] = useState(0)
  const [filter, setFilter] = useState<'all' | Decision>('all')
  const [authError, setAuthError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<{ eligible_matches: number; distinct_email_addresses: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'X-Operator-Token': token, ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
    })
    if (response.status === 401) {
      sessionStorage.removeItem('clickpe-operator-token'); setToken(''); setAuthError('Your session ended. Enter the operator token again.')
      throw new Error('Session expired')
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.detail || `Request failed (${response.status})`)
    }
    return response.json()
  }

  const refresh = async () => {
    if (!token) return
    try {
      const data = await request('/api/dashboard') as Dashboard
      const policies = await request('/api/policies/pending') as PendingPolicy[]
      setDashboard(data); setPendingPolicies(policies); setError('')
      if (!selectedRun && data.runs.length) setSelectedRun(data.runs[0])
      else if (selectedRun) setSelectedRun(data.runs.find((r) => r.run_id === selectedRun.run_id) || selectedRun)
    } catch (e) { if ((e as Error).message !== 'Session expired') setError((e as Error).message) }
  }

  useEffect(() => { if (token) void refresh() }, [token])
  useEffect(() => { if (!token) return; const timer = window.setInterval(() => { void refresh() }, 6000); return () => clearInterval(timer) }, [token, selectedRun?.run_id])
  useEffect(() => {
    if (!token || !selectedRun) return
    const decision = filter === 'all' ? '' : `&decision=${filter}`
    request(`/api/runs/${selectedRun.run_id}/results?limit=40&offset=0${decision}`)
      .then((data) => { setResults(data.results); setTotalResults(data.total) })
      .catch((e) => setError((e as Error).message))
  }, [token, selectedRun?.run_id, filter, selectedRun?.status, selectedRun?.matched_count, selectedRun?.unmatched_count, selectedRun?.review_count])

  const metrics = useMemo(() => {
    const run = selectedRun
    return [
      { label: 'Profiles received', value: fmt(run?.row_count || 0), caption: run ? `${fmt(run.duplicate_email_count)} repeated email addresses` : 'Select a run to see results', icon: FileText, tone: 'blue' },
      { label: 'Eligible matches', value: fmt(run?.matched_count || 0), caption: 'Meet every confirmed rule', icon: BadgeCheck, tone: 'green' },
      { label: 'Do not meet known rules', value: fmt(run?.unmatched_count || 0), caption: 'Failed at least one hard requirement', icon: ShieldCheck, tone: 'red' },
      { label: 'Manual review', value: fmt(run?.review_count || 0), caption: 'A term needs clarification', icon: CircleHelp, tone: 'amber' },
    ]
  }, [selectedRun])

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault(); setAuthError('')
    const candidate = draftToken.trim()
    try {
      const response = await fetch(`${API}/api/dashboard`, { headers: { 'X-Operator-Token': candidate } })
      if (!response.ok) throw new Error(response.status === 401 ? 'That token was not accepted.' : 'The API is not reachable yet.')
      sessionStorage.setItem('clickpe-operator-token', candidate); setToken(candidate); setDashboard(await response.json())
    } catch (e) { setAuthError((e as Error).message) }
  }

  const upload = async (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) { setError('Choose a .csv file.'); return }
    if (dashboard && file.size > dashboard.max_upload_bytes) { setError('That CSV exceeds the 25 MiB upload limit.'); return }
    setLoading(true); setError(''); setPreview(null)
    try {
      let data: { upload_id: string }
      if (dashboard?.storage_mode === 's3') {
        const signed = await request(`/api/uploads?filename=${encodeURIComponent(file.name)}`, { method: 'POST' })
        const form = new FormData()
        Object.entries(signed.upload.fields as Record<string, string>).forEach(([key, value]) => form.append(key, value))
        form.append('file', file)
        const uploaded = await fetch(signed.upload.url as string, { method: 'POST', body: form })
        if (!uploaded.ok) throw new Error('Object storage rejected the CSV upload. Try again or check the cloud upload configuration.')
        data = { upload_id: signed.upload_id as string }
      } else {
        const body = new FormData(); body.append('file', file)
        data = await request('/api/uploads/local', { method: 'POST', body })
      }
      setError(`Upload accepted · ${data.upload_id.slice(0, 8)} · processing in the background`)
      window.setTimeout(() => void refresh(), 1000)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false); if (fileInput.current) fileInput.current.value = '' }
  }

  const makePreview = async () => {
    if (!selectedRun) return
    try { setPreview(await request(`/api/runs/${selectedRun.run_id}/notification-preview`, { method: 'POST', body: '{}' })) }
    catch (e) { setError((e as Error).message) }
  }

  const approvePolicy = async (policy: PendingPolicy) => {
    try {
      await request(`/api/policies/${policy.snapshot_id}/approve`, { method: 'POST', body: '{}' })
      setError(`${policy.lender} policy approved · new analyses will use this version`)
      await refresh()
    } catch (e) { setError((e as Error).message) }
  }

  if (!token) return <main className="login-shell"><div className="login-card">
    <div className="brand-mark"><Banknote size={20} strokeWidth={2.3} /></div>
    <span className="eyebrow">CLICKPE · OPERATIONS</span>
    <h1>Your loan eligibility workspace</h1>
    <p>Sign in with the operator token configured for this demo. Applicant information is protected behind the API.</p>
    <form onSubmit={signIn} className="login-form"><label htmlFor="operator-token">Operator token</label><input autoComplete="current-password" id="operator-token" type="password" value={draftToken} onChange={(e) => setDraftToken(e.target.value)} placeholder="Paste your operator token" required /><button className="button primary full" type="submit">Open workspace <ArrowRight size={16} /></button></form>
    {authError && <div role="alert" className="alert error">{authError}</div>}
    <div className="login-foot"><LockKeyhole size={14} />Token remains in this browser tab only</div>
  </div><div className="login-side"><div className="login-side-brand"><div className="brand-mark light"><Banknote size={19} /></div><span>clickpe</span></div><div><span className="eyebrow">BETTER MATCHES. CLEARER REASONS.</span><h2>Turn lender criteria into thoughtful next steps.</h2><p>One transparent run at a time. Every match has a source, a rule and a reason you can review.</p></div><div className="login-side-bottom">A prototype workspace · decisions stay human-reviewed</div></div></main>

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Banknote size={18} strokeWidth={2.3} /></div><span>clickpe</span><span className="workspace-chip">OPS</span></div>
      <div className="sidebar-section"><div className="sidebar-label">WORKSPACE</div><button className="nav-item active"><FileChartColumn size={17} /><span>Overview</span></button><button className="nav-item" onClick={() => document.getElementById('run-detail')?.scrollIntoView({ behavior: 'smooth' })}><FolderClock size={17} /><span>Eligibility runs</span>{dashboard?.runs.length ? <span className="nav-count">{dashboard.runs.length}</span> : null}</button><button className="nav-item" onClick={() => document.getElementById('policy-review')?.scrollIntoView({ behavior: 'smooth' })}><Banknote size={17} /><span>Policy review</span>{pendingPolicies.length ? <span className="nav-count">{pendingPolicies.length}</span> : null}</button></div>
      <div className="sidebar-spacer" />
      <div className="side-note"><div className="side-note-icon"><Fingerprint size={16} /></div><div><strong>Privacy first</strong><p>Names and email addresses are never passed to the matching workflow.</p></div></div>
      <button className="nav-item side-bottom" onClick={() => { sessionStorage.removeItem('clickpe-operator-token'); setToken(''); setDraftToken('') }}><LogOut size={16} /><span>Sign out</span></button>
      <div className="sidebar-profile"><div className="avatar">O</div><div><strong>Operator</strong><span>Eligibility team</span></div><MoreHorizontal size={18} className="profile-more" /></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>Overview</strong></div><div className="topbar-right"><div className="system-status"><span className="pulse" /> Engine ready</div><button className="icon-button" title="Refresh dashboard" onClick={() => void refresh()}><RotateCw size={16} /></button><div className="top-avatar">O</div></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="date-eyebrow">YOUR LENDING WORKSPACE</div><h1>Good to see you, Operator <span className="wave">✳</span></h1><p>Review your latest portfolio run and what comes next.</p></div><button className="button ghost refresh-wide" onClick={() => void refresh()}><RotateCw size={15} /> Refresh</button></div>

        {error && <div className={`alert ${error.includes('accepted') ? 'success' : 'error'}`} role="status"><span>{error}</span><button aria-label="Dismiss" className="alert-dismiss" onClick={() => setError('')}><X size={15} /></button></div>}

        <section className="metric-grid" aria-label="Selected run metrics">{metrics.map(({ label, value, caption, icon: Icon, tone }) => <article key={label} className="metric-card"><div className="metric-top"><span>{label}</span><div className={`metric-icon ${tone}`}><Icon size={17} /></div></div><div className="metric-value">{value}</div><div className="metric-caption">{caption}</div></article>)}</section>

        <div className="workspace-grid">
          <section className="panel upload-panel"><div className="panel-heading"><div><div className="section-kicker">NEW ANALYSIS</div><h2>Import applicant profiles</h2></div><span className="format-badge">CSV · UP TO 25 MB</span></div><p className="panel-desc">Upload the standard applicant file to evaluate profiles against the active lender policies.</p><div className={`dropzone ${dragging ? 'drag-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files[0]) }}><div className="upload-icon"><UploadCloud size={21} /></div><strong>{loading ? 'Preparing your upload…' : 'Drop your CSV file here'}</strong><span>or browse files from your device</span><button className="button primary browse-button" disabled={loading} onClick={() => fileInput.current?.click()}>{loading ? 'Uploading' : 'Browse files'} {!loading && <ArrowRight size={14} />}</button><input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => void upload(e.target.files?.[0])} /></div><div className="privacy-note"><ShieldCheck size={15} /><span>Names and email addresses stay inside the application database. The matcher sees eligibility fields only.</span></div></section>

          <section className="panel activity-panel"><div className="panel-heading"><div><div className="section-kicker">RECENT ACTIVITY</div><h2>Your latest runs</h2></div><button className="icon-button small" title="Refresh runs" onClick={() => void refresh()}><RotateCw size={15} /></button></div>{dashboard?.runs.length ? <div className="run-list">{dashboard.runs.slice(0, 5).map((run) => <button key={run.run_id} className={`run-row ${selectedRun?.run_id === run.run_id ? 'selected' : ''}`} onClick={() => { setSelectedRun(run); setPreview(null) }}><span className={`run-icon ${run.status}`}><FileText size={16} /></span><span className="run-meta"><strong>Portfolio analysis</strong><small>{fmt(run.row_count)} applicants · {relative(run.created_at)}</small></span><span className={`status-pill ${run.status}`}>{run.status === 'completed' ? <Check size={12} /> : run.status === 'processing' ? <span className="mini-pulse" /> : null}{run.status}</span><ChevronDown className="run-chevron" size={14} /></button>)}</div> : <div className="empty-activity"><span className="empty-icon"><FolderClock size={20} /></span><strong>No analysis runs yet</strong><span>Upload your first applicant CSV to get started.</span></div>}<button className="text-action" onClick={() => document.getElementById('run-detail')?.scrollIntoView({ behavior: 'smooth' })}>View selected run <ArrowRight size={14} /></button></section>
        </div>

        {preview && <section className="alert preview-info" role="status"><div><strong>Preview ready</strong><span>{fmt(preview.eligible_matches)} eligible matches across {fmt(preview.distinct_email_addresses)} unique email addresses. Delivery is disabled; no emails were sent.</span></div><button className="alert-dismiss" onClick={() => setPreview(null)}><X size={16} /></button></section>}

        <section className="panel results-panel" id="run-detail"><div className="results-heading"><div><div className="section-kicker">DECISION REVIEW</div><h2>{selectedRun ? 'Applicant results' : 'Results will appear here'}</h2><p>{selectedRun ? `Run ${selectedRun.run_id.slice(0, 8)} · ${fmt(selectedRun.row_count)} applicant profiles` : 'Select a completed analysis run to explore the matches.'}</p></div><div className="result-actions"><div className="filter-control"><Search size={14} /><select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter results"><option value="all">All decisions</option><option value="eligible">Eligible</option><option value="review">Needs review</option><option value="ineligible">Do not qualify</option></select><ChevronDown size={14} /></div><button className="button outline" onClick={() => void makePreview()} disabled={!selectedRun || selectedRun.status !== 'completed'}><CirclePlay size={15} /> Notification preview</button></div></div>
          {selectedRun?.status === 'processing' || selectedRun?.status === 'queued' ? <div className="processing-banner"><span className="loading-spinner" /><span><strong>Your results are on the way</strong><small>The workflow checks applicant profiles in small batches. This view refreshes automatically.</small></span><span className="processing-status">{selectedRun.status}</span></div> : null}
          {selectedRun?.status === 'failed' && <div className="processing-banner error-banner"><span><strong>This run needs attention</strong><small>Open the workflow in n8n and check its execution status. Applicant details are not included in error logs.</small></span></div>}
          {results.length ? <><div className="results-table-wrap"><table><thead><tr><th>APPLICANT ID</th><th>LENDER PRODUCT</th><th>DECISION</th><th>WHY THIS RESULT</th><th></th></tr></thead><tbody>{results.map((result) => <tr key={result.result_id}><td><span className="user-id">{result.user_id}</span></td><td><div className="product-cell"><div className="bank-icon"><Banknote size={15} /></div><span><strong>{result.lender}</strong><small>{result.product_name}</small></span></div></td><td><span className={`decision ${result.decision}`}>{result.decision === 'eligible' ? <BadgeCheck size={13} /> : result.decision === 'review' ? <CircleHelp size={13} /> : <ShieldCheck size={13} />}{result.decision === 'ineligible' ? 'Does not qualify' : result.decision === 'review' ? 'Needs review' : 'Eligible'}</span></td><td><span className="reason-text">{result.reasons.find((reason) => reason.status === 'fail')?.criterion?.replace('_', ' ') || result.reasons.find((reason) => reason.status === 'unknown' || reason.status === 'review')?.message || 'All confirmed criteria are met'}</span></td><td><button className="row-more" title="Decision details" onClick={() => window.alert(result.reasons.map((reason) => `${reason.criterion}: ${reason.status}${reason.message ? ` — ${reason.message}` : ''}`).join('\n'))}><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div><div className="table-footer"><span>Showing {Math.min(results.length, totalResults)} of {fmt(totalResults)} results</span><span>Applicant identities stay masked</span></div></> : selectedRun?.status === 'completed' ? <div className="empty-results"><div className="empty-icon"><FileChartColumn size={19} /></div><strong>No decisions to show yet</strong><span>Check whether there are approved lender policies available for this run.</span></div> : null}
        </section>

        <section id="policy-review" className="policy-review-section"><div className="lender-heading"><div><div className="section-kicker">HUMAN REVIEW</div><h2>Policy changes to review</h2><p>AI extracts source terms for review. It never changes a live rule by itself.</p></div><span className="review-count">{pendingPolicies.length} awaiting</span></div>{pendingPolicies.length ? <div className="pending-policy-grid">{pendingPolicies.map((policy) => <article className="pending-policy" key={policy.snapshot_id}><div className="pending-policy-top"><div className="lender-logo">{policy.lender === 'Axis Bank' ? 'A' : 'B'}</div><div><strong>{policy.lender} · {policy.product_name}</strong><span>Extracted {relative(policy.observed_at)} · {policy.model_provider} / {policy.model_name}</span></div></div><div className="criteria-chips">{Object.entries(policy.rules).filter(([key]) => key !== 'version' && key !== 'incomplete_eligibility').map(([key, rule]) => <span key={key}><b>{key.replace('_', ' ')}</b> {rule.kind === 'unknown' ? 'not found' : rule.kind === 'required' || rule.kind === 'preferred' ? `${rule.min ?? rule.status ?? ''}${rule.max ? `–${rule.max}` : ''}${rule.currency ? ` ${rule.currency}` : ''}${rule.kind === 'preferred' ? ' preferred' : ''}${rule.location_dependent ? ' · location based' : ''}` : rule.status}</span>)}</div><details className="source-evidence"><summary>Review source excerpt and criteria</summary><p>{policy.reviewer_note}</p><pre>{policy.source_excerpt}</pre><a href={policy.source_url} target="_blank" rel="noreferrer">Open official source <ArrowRight size={12} /></a></details><div className="pending-policy-actions"><span><ShieldCheck size={13} />Manual approval changes future runs</span><button className="button primary" onClick={() => void approvePolicy(policy)}><Check size={14} /> Approve criteria</button></div></article>)}</div> : <div className="empty-policy"><span className="source-count-dot" /><span>All active lender criteria have an approved source.</span></div>}</section>

        <section id="lenders" className="lender-section"><div className="lender-heading"><div><div className="section-kicker">ACTIVE SOURCES</div><h2>Policies powering this run</h2><p>Every decision links back to lender-published criteria.</p></div><span className="source-count"><span className="source-count-dot" />{dashboard?.products.length || 0} sources active</span></div><div className="lender-grid">{dashboard?.products.map((product, index) => <article key={product.product_id} className="lender-card"><div className={`lender-logo ${index ? 'bajaj' : 'axis'}`}>{index ? 'B' : 'A'}</div><div className="lender-copy"><strong>{product.lender}</strong><span>{product.product_name}</span><a href={product.product_url} target="_blank" rel="noreferrer">Official eligibility page <ArrowRight size={12} /></a></div><div className="policy-verified"><span className="verified-dot" /><span>{product.extraction_status === 'approved' ? `Reviewed ${product.observed_at ? relative(product.observed_at) : 'baseline'}` : 'Needs review'}</span></div></article>)}</div></section>

        <footer className="page-footer"><span>ClickPe eligibility workspace</span><span>Screening aid only · lender decisions remain independent</span><a href="mailto:hello@clickpe.ai">Need a hand? <CircleHelp size={13} /></a></footer>
      </div>
    </main>
  </div>
}
