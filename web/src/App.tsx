import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router";
import {
  ArrowRight,
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  Users,
  X,
} from "lucide-react";

const API =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "http://localhost:8000" : "");
const fmt = (n: number) => new Intl.NumberFormat("en-IN").format(n || 0);
const date = (v: string) =>
  new Date(v).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const labels: Record<string, string> = {
  matched: "Matched",
  review: "Needs review",
  unmatched: "No match",
  processing: "Processing",
  queued: "Queued",
  completed: "Completed",
  failed: "Failed",
  eligible: "Eligible",
  ineligible: "Not eligible",
};
const errors: Record<string, string> = {
  empty_csv: "The CSV has no applicant rows.",
  invalid_csv: "Check the CSV formatting and upload it again.",
  invalid_csv_schema:
    "Use the required columns shown below, then upload the corrected CSV.",
  invalid_encoding: "Save the CSV as UTF-8 and upload it again.",
  invalid_row:
    "Check for missing or invalid applicant values, then upload the corrected CSV.",
  too_many_rows: "Use a CSV with at most 100,000 applicants.",
  matching_failed:
    "Matching could not finish. Retry to continue from the last saved batch.",
  workflow_unavailable:
    "Matching is unavailable. Retry when the service is restored.",
  import_failed: "Import could not finish. Check the CSV and upload it again.",
  file_too_large: "The CSV exceeds the upload limit.",
};
type Product = {
  product_id: string;
  lender: string;
  product_name: string;
  product_url: string;
  advertised_rate?: string;
  observed_at?: string;
  extraction_status?: string;
};
type Run = {
  run_id: string;
  upload_id?: string;
  filename: string;
  status: string;
  row_count: number;
  created_at: string;
  error_code?: string;
  product_count?: number;
  processed_decisions?: number;
  processed_applicants?: number;
  applicant_summary?: Record<string, number>;
  products?: Product[];
};
type Dashboard = {
  total_rows: number;
  total_runs: number;
  products: Product[];
  storage_mode: string;
  max_upload_bytes: number;
};
type Rule = {
  kind: string;
  min?: number;
  max?: number;
  status?: string;
  currency?: string;
  location_dependent?: boolean;
};
type Policy = {
  snapshot_id: string;
  lender: string;
  product_name: string;
  source_url: string;
  source_excerpt: string;
  observed_at: string;
  advertised_rate?: string;
  rate_source_quote?: string;
  reviewer_note?: string;
  rules: Record<string, Rule>;
};
type Applicant = {
  user_id: string;
  status: string;
  processed_decisions: number;
  matched_products: Product[];
};
type Reason = {
  criterion: string;
  status: string;
  message?: string;
  observed_value?: string | number;
  required_value?: string;
  minimum?: number;
  maximum?: number;
  preferred_minimum?: number;
  currency?: string;
};
type Result = {
  result_id: string;
  lender: string;
  product_name: string;
  decision: string;
  reasons: Reason[];
  source_url: string;
  snapshot_id: string;
  rule_version: string;
  observed_at: string;
  advertised_rate?: string;
};
type Job = {
  filename: string;
  started: number;
  upload_id?: string;
  run_id?: string;
  phase: "upload" | "import" | "match" | "ready" | "failed";
  percent: number;
  confirming?: boolean;
  error?: string;
  run?: Run;
  reconnecting?: boolean;
};
type Request = <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
type Workspace = {
  token: string;
  setToken: (v: string) => void;
  authError: string;
  dashboard: Dashboard | null;
  runs: Run[];
  totalRuns: number;
  pending: Policy[];
  error: string;
  request: Request;
  refresh: () => Promise<void>;
  job: Job | null;
  upload: (file: File) => Promise<void>;
  clearJob: () => void;
  retry: (runId: string) => Promise<void>;
  moreRuns: () => Promise<void>;
};
const Context = createContext<Workspace>(null!);
const useWorkspace = () => useContext(Context);
const storageKey = "clickpe-active-upload";
function savedJob(): Job | null {
  try {
    const j = JSON.parse(
      sessionStorage.getItem(storageKey) || "null",
    ) as Job | null;
    return j?.upload_id && j.phase !== "upload" ? j : null;
  } catch {
    return null;
  }
}
function Provider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(
    () => sessionStorage.getItem("clickpe-operator-token") || "",
  );
  const [authError, setAuthError] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [runs, setRuns] = useState<Run[]>([]),
    [totalRuns, setTotalRuns] = useState(0);
  const [pending, setPending] = useState<Policy[]>([]),
    [error, setError] = useState("");
  const [job, setJob] = useState<Job | null>(savedJob);
  const transferring = useRef(false);
  const setToken = useCallback((v: string) => {
    setTokenState(v);
    if (v) sessionStorage.setItem("clickpe-operator-token", v);
    else sessionStorage.removeItem("clickpe-operator-token");
  }, []);
  const expire = useCallback(() => {
    setToken("");
    setAuthError(
      "Your session expired. Sign in again to continue monitoring this file.",
    );
  }, [setToken]);
  const request: Request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          "X-Operator-Token": token,
          ...(!(init.body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
          ...init.headers,
        },
      });
      if (response.status === 401) {
        expire();
        throw new Error("Session expired");
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed (${response.status})`);
      }
      return response.json() as Promise<T>;
    },
    [token, expire],
  );
  const refresh = useCallback(async () => {
    try {
      const [d, r, p] = await Promise.all([
        request<Dashboard>("/api/dashboard"),
        request<{ items: Run[]; total: number }>("/api/runs?limit=20"),
        request<Policy[]>("/api/policies/pending"),
      ]);
      setDashboard(d);
      setRuns((current) => [
        ...r.items,
        ...current.filter(
          (old) => !r.items.some((item) => item.run_id === old.run_id),
        ),
      ]);
      setTotalRuns(r.total);
      setPending(p);
      setError("");
    } catch (e) {
      if ((e as Error).message !== "Session expired")
        setError(
          "Unable to refresh the workspace. Check your connection and try again.",
        );
    }
  }, [request]);
  useEffect(() => {
    if (!token) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 6000);
    return () => clearInterval(timer);
  }, [token, refresh]);
  useEffect(() => {
    if (job?.upload_id) sessionStorage.setItem(storageKey, JSON.stringify(job));
    else sessionStorage.removeItem(storageKey);
  }, [job]);
  const active = job?.phase === "import" || job?.phase === "match";
  useEffect(() => {
    if (!token || !active || !job?.upload_id) return;
    let stopped = false,
      timer = 0,
      failures = 0;
    const controller = new AbortController(),
      uploadId = job.upload_id;
    const poll = async () => {
      try {
        const upload = await request<{
          status: string;
          run_id: string | null;
          error_code: string | null;
        }>(`/api/uploads/${uploadId}`, { signal: controller.signal });
        const run = upload.run_id
          ? await request<Run>(`/api/runs/${upload.run_id}/progress`, {
              signal: controller.signal,
            })
          : undefined;
        if (stopped) return;
        failures = 0;
        const failed = upload.status === "failed" || run?.status === "failed";
        const code = run?.error_code || upload.error_code || "";
        setJob(
          (old) =>
            old && {
              ...old,
              run_id: upload.run_id || undefined,
              run,
              reconnecting: false,
              phase: failed
                ? "failed"
                : run?.status === "completed"
                  ? "ready"
                  : run
                    ? "match"
                    : "import",
              error: failed
                ? errors[code] ||
                  "Processing could not finish. Review this run or upload a corrected file."
                : undefined,
            },
        );
        if (failed || run?.status === "completed") {
          void refresh();
          return;
        }
      } catch (e) {
        if (stopped || (e as Error).message === "Session expired") return;
        failures++;
        setJob((old) => old && { ...old, reconnecting: true });
      }
      if (!stopped)
        timer = window.setTimeout(poll, Math.min(1500 * 2 ** failures, 15000));
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [token, active, job?.upload_id, request, refresh]);
  const sendFile = (url: string, body: FormData, authenticated: boolean) =>
    new Promise<{ upload_id?: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      if (authenticated) xhr.setRequestHeader("X-Operator-Token", token);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          setJob(
            (old) =>
              old && {
                ...old,
                percent: Math.min(
                  100,
                  Math.round((event.loaded / event.total) * 100),
                ),
                confirming: event.loaded === event.total,
              },
          );
      };
      xhr.upload.onload = () =>
        setJob((old) => old && { ...old, percent: 100, confirming: true });
      xhr.onload = () => {
        if (xhr.status === 401) {
          expire();
          reject(new Error("Session expired"));
          return;
        }
        let response: { detail?: string; upload_id?: string } = {};
        try {
          response = JSON.parse(xhr.responseText || "{}");
        } catch {
          /* S3 can respond without JSON. */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(response);
        else
          reject(
            new Error(
              response.detail ||
                `Upload was rejected (${xhr.status}). Check the file and try again.`,
            ),
          );
      };
      xhr.onerror = () =>
        reject(
          new Error(
            "The connection ended before upload was confirmed. Check recent files before trying again.",
          ),
        );
      xhr.send(body);
    });
  const upload = async (file: File) => {
    if (transferring.current || active) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a CSV file.");
      return;
    }
    if (!dashboard) {
      setError("Wait for the workspace to load before uploading.");
      return;
    }
    if (!file.size || file.size > dashboard.max_upload_bytes) {
      setError(
        `Choose a nonempty CSV under ${Math.round(dashboard.max_upload_bytes / 1024 / 1024)} MiB.`,
      );
      return;
    }
    transferring.current = true;
    setError("");
    setJob({
      filename: file.name,
      started: Date.now(),
      phase: "upload",
      percent: 0,
    });
    try {
      let uploadId: string;
      if (dashboard.storage_mode === "s3") {
        const signed = await request<{
          upload_id: string;
          upload: { url: string; fields: Record<string, string> };
        }>(`/api/uploads?filename=${encodeURIComponent(file.name)}`, {
          method: "POST",
        });
        const body = new FormData();
        Object.entries(signed.upload.fields).forEach(([key, value]) =>
          body.append(key, value),
        );
        body.append("file", file);
        await sendFile(signed.upload.url, body, false);
        uploadId = signed.upload_id;
      } else {
        const body = new FormData();
        body.append("file", file);
        const response = await sendFile(`${API}/api/uploads/local`, body, true);
        if (!response.upload_id)
          throw new Error(
            "Upload confirmation was incomplete. Check recent files before trying again.",
          );
        uploadId = response.upload_id;
      }
      setJob(
        (old) =>
          old && {
            ...old,
            upload_id: uploadId,
            phase: "import",
            percent: 100,
            confirming: false,
          },
      );
    } catch (e) {
      setJob(
        (old) =>
          old && { ...old, phase: "failed", error: (e as Error).message },
      );
    } finally {
      transferring.current = false;
    }
  };
  const retry = async (runId: string) => {
    await request(`/api/runs/${runId}/retry`, { method: "POST" });
    const run = await request<Run>(`/api/runs/${runId}/progress`);
    setJob({
      filename: run.filename,
      started: Date.now(),
      upload_id: run.upload_id,
      run_id: runId,
      phase: "match",
      percent: 100,
      run,
    });
    await refresh();
  };
  const moreRuns = async () => {
    const r = await request<{ items: Run[]; total: number }>(
      `/api/runs?limit=20&offset=${runs.length}`,
    );
    setRuns((old) => [
      ...old,
      ...r.items.filter((item) => !old.some((r) => r.run_id === item.run_id)),
    ]);
    setTotalRuns(r.total);
  };
  return (
    <Context.Provider
      value={{
        token,
        setToken,
        authError,
        dashboard,
        runs,
        totalRuns,
        pending,
        error,
        request,
        refresh,
        job,
        upload,
        clearJob: () => setJob(null),
        retry,
        moreRuns,
      }}
    >
      {children}
    </Context.Provider>
  );
}
function Status({ value }: { value: string }) {
  return <span className={`status ${value}`}>{labels[value] || value}</span>;
}
function SignIn() {
  const { setToken, authError } = useWorkspace(),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">
          <Banknote />
          clickpe
        </div>
        <h1>Operations workspace</h1>
        <p>
          Sign in to import applicants, review matches and manage lender
          policies.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await fetch(`${API}/api/dashboard`, {
                headers: { "X-Operator-Token": draft.trim() },
              });
              if (!r.ok)
                throw new Error(
                  r.status === 401
                    ? "That operator token was not accepted."
                    : "The workspace is unavailable. Try again shortly.",
                );
              setToken(draft.trim());
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="token">Operator token</label>
          <input
            id="token"
            type="password"
            required
            autoComplete="current-password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="button primary" disabled={busy}>
            {busy ? "Signing in…" : "Open workspace"}
            <ArrowRight size={16} />
          </button>
        </form>
        {(error || authError) && (
          <p className="alert" role="alert">
            {error || authError}
          </p>
        )}
        <small>Your session is kept in this browser tab.</small>
      </div>
    </main>
  );
}
function Shell() {
  const { token, setToken, error, refresh, job } = useWorkspace(),
    location = useLocation();
  if (!token) return <SignIn />;
  const current =
    location.pathname === "/policies"
      ? "Policies"
      : location.pathname === "/applicants"
        ? "Applicants"
        : "Overview";
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" to="/overview">
          <Banknote />
          clickpe
        </Link>
        <span className="workspace-label">OPERATIONS</span>
        <nav aria-label="Workspace">
          <NavLink to="/overview">
            <LayoutDashboard size={19} />
            Overview
          </NavLink>
          <NavLink to="/applicants">
            <Users size={19} />
            Applicants
          </NavLink>
          <NavLink to="/policies">
            <ShieldCheck size={19} />
            Policies
          </NavLink>
          <button
            className="mobile-signout"
            aria-label="Sign out"
            onClick={() => setToken("")}
          >
            <LogOut size={16} />
          </button>
        </nav>
        <div className="sidebar-foot">
          <span>Operator workspace</span>
          <button onClick={() => setToken("")}>
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>
            Workspace <span className="muted">/</span>{" "}
            <strong>{current}</strong>
          </span>
          <button
            className="icon-button"
            aria-label="Refresh workspace"
            onClick={() => void refresh()}
          >
            <RefreshCw size={17} />
          </button>
        </header>
        <main className="content">
          {error && (
            <div role="alert" className="alert">
              {error}
              <button onClick={() => void refresh()}>Try again</button>
            </div>
          )}
          {job && current !== "Overview" && (
            <Link className="job-link" to="/overview">
              {job.phase === "ready"
                ? "Your applicants are ready"
                : job.phase === "failed"
                  ? "An upload needs attention"
                  : `Processing ${job.filename}`}
              <ArrowRight size={16} />
            </Link>
          )}
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/applicants" element={<Applicants />} />
            <Route path="/policies" element={<Policies />} />
            <Route
              path="*"
              element={
                <div className="empty">
                  <h1>Page not found</h1>
                  <Link to="/overview">Return to overview</Link>
                </div>
              }
            />
          </Routes>
          <footer>ClickPe · Eligibility screening workspace</footer>
        </main>
      </div>
    </div>
  );
}
function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="heading">
      <h1>{title}</h1>
      <p>{children}</p>
    </div>
  );
}
function Progress() {
  const { job, clearJob, retry } = useWorkspace(),
    [now, setNow] = useState(Date.now()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!job) return null;
  const step = {
    upload: 0,
    import: 1,
    match: 2,
    ready: 3,
    failed: job.run_id ? 2 : job.upload_id ? 1 : 0,
  }[job.phase];
  const total = (job.run?.row_count || 0) * (job.run?.product_count || 0),
    processed = job.run?.processed_decisions || 0;
  const percent =
    job.phase === "upload"
      ? job.percent
      : job.phase === "ready"
        ? 100
        : total
          ? Math.min(100, (processed / total) * 100)
          : 0;
  return (
    <section className="panel progress-panel" aria-label="Upload progress">
      <div className="section-title">
        <div>
          <h2>
            {job.phase === "ready"
              ? "Applicants are ready"
              : job.phase === "failed"
                ? "This file needs attention"
                : "Preparing your applicants"}
          </h2>
          <p className="filename">{job.filename}</p>
        </div>
        {(job.phase === "ready" || job.phase === "failed") && (
          <button
            className="icon-button"
            aria-label="Dismiss upload status"
            onClick={clearJob}
          >
            <X size={18} />
          </button>
        )}
      </div>
      <ol className="steps">
        {["Upload", "Import", "Match", "Ready"].map((label, i) => (
          <li
            key={label}
            className={
              i < step || job.phase === "ready"
                ? "done"
                : i === step
                  ? "current"
                  : ""
            }
          >
            <span>
              {i < step || job.phase === "ready" ? <Check size={14} /> : i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <div role="status" aria-live="polite" className="progress-copy">
        {job.reconnecting ? (
          <>
            <LoaderCircle className="spinner" size={17} />
            Reconnecting · your file continues processing
          </>
        ) : job.phase === "upload" ? (
          <>
            <LoaderCircle className="spinner" size={17} />
            {job.confirming
              ? "100% sent · confirming receipt…"
              : `Uploading · ${job.percent}%`}
          </>
        ) : job.phase === "import" ? (
          <>
            <LoaderCircle className="spinner" size={17} />
            Importing applicant rows · {Math.floor((now - job.started) / 1000)}s
            elapsed
          </>
        ) : job.phase === "match" ? (
          <>
            <LoaderCircle className="spinner" size={17} />
            {fmt(processed)} of {fmt(total)} lender decisions saved
          </>
        ) : job.phase === "ready" ? (
          `${fmt(job.run?.row_count || 0)} applicants checked against ${job.run?.product_count || 0} lender products`
        ) : (
          job.error
        )}
      </div>
      {(job.phase === "upload" || job.phase === "match") && (
        <progress
          max="100"
          value={percent}
          aria-label={
            job.phase === "upload" ? "File transfer" : "Lender matching"
          }
        />
      )}
      {job.phase === "import" && (
        <p className="muted small">
          You can keep working here. Progress continues across workspace pages.
        </p>
      )}
      {job.phase === "ready" && (
        <Link className="button primary" to={`/applicants?run=${job.run_id}`}>
          View applicants
          <ArrowRight size={16} />
        </Link>
      )}
      {job.phase === "failed" && job.run_id && (
        <button
          className="button outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await retry(job.run_id!);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Retrying…" : "Retry matching"}
        </button>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function Overview() {
  const { dashboard, runs, totalRuns, pending, job, upload } = useWorkspace(),
    file = useRef<HTMLInputElement>(null),
    [dragging, setDragging] = useState(false);
  const busy = !!job && ["upload", "import", "match"].includes(job.phase);
  return (
    <>
      <Heading title="Overview">
        Import an applicant file and follow its progress through eligibility
        matching.
      </Heading>
      <section className="metrics" aria-label="Workspace summary">
        {[
          ["Applicants imported", dashboard?.total_rows],
          ["Analysis runs", totalRuns],
          ["Active lender products", dashboard?.products.length],
          ["Policy changes to review", pending.length],
        ].map(([label, value]) => (
          <article className="metric" key={label}>
            <span>{label}</span>
            <strong>{dashboard ? fmt(Number(value)) : "—"}</strong>
          </article>
        ))}
      </section>
      <div className="overview-grid">
        <section className="panel upload-panel">
          <div className="section-title">
            <div>
              <h2>Import applicants</h2>
              <p>Start a new eligibility analysis with a CSV file.</p>
            </div>
            <UploadCloud size={23} />
          </div>
          <button
            className={`dropzone ${dragging ? "dragging" : ""}`}
            disabled={busy || !dashboard}
            onClick={() => file.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!busy && e.dataTransfer.files[0])
                void upload(e.dataTransfer.files[0]);
            }}
          >
            <UploadCloud size={30} />
            <strong>
              {busy
                ? "Your file is being processed"
                : "Choose a CSV or drop it here"}
            </strong>
            <span>
              Up to{" "}
              {dashboard
                ? Math.round(dashboard.max_upload_bytes / 1024 / 1024)
                : 25}{" "}
              MiB · 100,000 applicants
            </span>
          </button>
          <input
            hidden
            ref={file}
            type="file"
            accept=".csv,text/csv"
            aria-label="Applicant CSV"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              e.target.value = "";
              if (selected) void upload(selected);
            }}
          />
          <details className="csv-help">
            <summary>Required CSV columns</summary>
            <code>
              user_id, name, email, monthly_income, credit_score,
              employment_status, age
            </code>
            <p>
              Use UTF-8. Each applicant needs a unique user_id. Income is
              monthly, in INR.
            </p>
          </details>
        </section>
        {job ? (
          <Progress />
        ) : (
          <section className="panel guide">
            <FileText size={26} />
            <h2>From file to clear next steps</h2>
            <p>
              Each applicant is checked against the lender policies active when
              the analysis starts.
            </p>
            <p>
              Review matched products and the reasons behind every lender
              decision on the Applicants page.
            </p>
            <Link to="/policies">
              View active policies
              <ArrowRight size={15} />
            </Link>
          </section>
        )}
      </div>
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Recent files</h2>
            <p>Your latest applicant analyses.</p>
          </div>
          <Link to="/applicants">
            Browse applicants
            <ArrowRight size={15} />
          </Link>
        </div>
        {runs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Imported</th>
                  <th>Applicants</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 8).map((run) => (
                  <tr key={run.run_id}>
                    <td>
                      <strong>{run.filename}</strong>
                    </td>
                    <td>{date(run.created_at)}</td>
                    <td>{fmt(run.row_count)}</td>
                    <td>
                      <Status value={run.status} />
                    </td>
                    <td>
                      <Link
                        className="row-link"
                        to={`/applicants?run=${run.run_id}`}
                      >
                        Open
                        <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <FileText />
            <h3>
              {dashboard ? "No files imported yet" : "Loading recent files…"}
            </h3>
            <p>Your first analysis will appear here after import.</p>
          </div>
        )}
      </section>
    </>
  );
}
function useRun(runId: string, revision = 0) {
  const { request } = useWorkspace(),
    [run, setRun] = useState<Run | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setRun(null);
    setError("");
    if (!runId) return;
    const controller = new AbortController();
    let timer = 0;
    const poll = async () => {
      try {
        const data = await request<Run>(`/api/runs/${runId}/progress`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setRun(data);
        setError("");
        if (!["completed", "failed"].includes(data.status))
          timer = window.setTimeout(poll, 3000);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
          timer = window.setTimeout(poll, 6000);
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [runId, request, revision]);
  return { run, error };
}
function Applicants() {
  const { runs, totalRuns, moreRuns, request, retry, dashboard } =
      useWorkspace(),
    [params, setParams] = useSearchParams();
  const runId = params.get("run") || runs[0]?.run_id || "",
    status = params.get("status") || "",
    product = params.get("product") || "",
    q = params.get("q") || "";
  const size = [25, 50, 100].includes(Number(params.get("size")))
    ? Number(params.get("size"))
    : 25;
  const page = Math.max(
    1,
    Math.min(
      Math.ceil(100000 / size),
      Math.floor(Number(params.get("page"))) || 1,
    ),
  );
  const [revision, setRevision] = useState(0);
  const { run, error: runError } = useRun(runId, revision);
  const [data, setData] = useState<{
      items: Applicant[];
      total: number;
    } | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
      eligible_matches: number;
      distinct_email_addresses: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [jump, setJump] = useState("");
  const update = (changes: Record<string, string>, reset = true) => {
    const next = new URLSearchParams(params);
    next.set("run", runId);
    if (reset) next.delete("page");
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    setParams(next);
  };
  useEffect(() => {
    if (!params.get("run") && runId) {
      const next = new URLSearchParams(params);
      next.set("run", runId);
      setParams(next, { replace: true });
    }
  }, [params, runId, setParams]);
  useEffect(() => {
    setPreview(null);
    setSelected(null);
  }, [runId]);
  useEffect(() => {
    setData(null);
    setError("");
    if (!runId) return;
    const controller = new AbortController();
    setLoading(true);
    const query = new URLSearchParams({
      limit: String(size),
      offset: String((page - 1) * size),
    });
    if (status) query.set("status", status);
    if (product) query.set("matched_product_id", product);
    if (q) query.set("q", q);
    const timer = window.setTimeout(
      () => {
        void request<{ items: Applicant[]; total: number }>(
          `/api/runs/${runId}/applicants?${query}`,
          { signal: controller.signal },
        )
          .then((result) => {
            if (controller.signal.aborted) return;
            const last = Math.max(1, Math.ceil(result.total / size));
            if (page > last) {
              const next = new URLSearchParams(params);
              next.set("page", String(last));
              setParams(next, { replace: true });
              return;
            }
            setData(result);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError((e as Error).message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      q ? 250 : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    request,
    runId,
    status,
    product,
    q,
    size,
    page,
    run?.processed_decisions,
    params,
    setParams,
  ]);
  const pages = Math.max(1, Math.ceil((data?.total || 0) / size)),
    numbers = [
      ...new Set([
        1,
        ...Array.from({ length: 5 }, (_, i) => page - 2 + i).filter(
          (n) => n > 1 && n < pages,
        ),
        pages,
      ]),
    ].sort((a, b) => a - b);
  const products = [
    ...new Map(
      (data?.items.flatMap((item) => item.matched_products) || []).map(
        (item) => [item.product_id, item],
      ),
    ).values(),
  ];
  return (
    <>
      <Heading title="Applicants">
        Review each applicant’s matched products and every lender decision.
      </Heading>
      <section className="panel run-picker">
        <label htmlFor="run">Analysis file</label>
        <div className="inline">
          <select
            id="run"
            value={runId}
            onChange={(e) =>
              update({ run: e.target.value, status: "", product: "", q: "" })
            }
          >
            {!runId && <option value="">No analyses available</option>}
            {runId && !runs.some((r) => r.run_id === runId) && (
              <option value={runId}>
                {run?.filename || "Selected analysis"}
              </option>
            )}
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.filename} · {date(r.created_at)}
              </option>
            ))}
          </select>
          {runs.length < totalRuns && (
            <button
              className="button outline"
              onClick={() =>
                void moreRuns().catch((e) => setError((e as Error).message))
              }
            >
              Load older files
            </button>
          )}
          {run && <Status value={run.status} />}
        </div>
      </section>
      {!runId ? (
        <div className="panel empty">
          <Users />
          <h2>Import your first applicant file</h2>
          <p>Completed and in-progress analyses will be available here.</p>
          <Link className="button primary" to="/overview">
            Import applicants
          </Link>
        </div>
      ) : (
        <>
          {runError && (
            <p className="alert" role="alert">
              {runError}
            </p>
          )}
          {run && (
            <section
              className="metrics applicant-metrics"
              aria-label="Applicant summary"
            >
              {["matched", "review", "unmatched", "processing"].map((key) => (
                <article className="metric" key={key}>
                  <span>{labels[key]}</span>
                  <strong>{fmt(run.applicant_summary?.[key] || 0)}</strong>
                </article>
              ))}
            </section>
          )}
          {run && !["completed", "failed"].includes(run.status) && (
            <div className="notice" role="status">
              <LoaderCircle size={18} className="spinner" />
              <span>
                Matching in progress · {fmt(run.processed_decisions || 0)} of{" "}
                {fmt(run.row_count * (run.product_count || 0))} lender decisions
                saved. Results update automatically.
              </span>
            </div>
          )}
          {run?.status === "failed" && (
            <div className="alert">
              <span>
                {errors[run.error_code || ""] ||
                  "This analysis could not finish. Retry matching to resume."}
              </span>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await retry(runId);
                    setRevision((n) => n + 1);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Retry matching
              </button>
            </div>
          )}
          <section className="panel applicants-panel">
            <div className="filters">
              <label>
                Applicant reference
                <input
                  type="search"
                  placeholder="Search by ID prefix"
                  value={q}
                  maxLength={128}
                  onChange={(e) => update({ q: e.target.value })}
                />
              </label>
              <label>
                Status
                <select
                  value={status}
                  onChange={(e) => update({ status: e.target.value })}
                >
                  <option value="">All applicants</option>
                  {["matched", "review", "unmatched", "processing"].map(
                    (key) => (
                      <option key={key} value={key}>
                        {labels[key]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Matched lender product
                <select
                  value={product}
                  onChange={(e) => update({ product: e.target.value })}
                >
                  <option value="">All products</option>
                  {[
                    ...new Map(
                      [
                        ...(run?.products || dashboard?.products || []),
                        ...products,
                      ].map((p) => [p.product_id, p]),
                    ).values(),
                  ].map((p) => (
                    <option key={p.product_id} value={p.product_id}>
                      {p.lender} · {p.product_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <div className="table-wrap applicant-table" aria-busy={loading}>
              <table>
                <thead>
                  <tr>
                    <th>Applicant reference</th>
                    <th>Matched lender products</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: 8 }, (_, i) => (
                        <tr key={i}>
                          <td>
                            <span className="skeleton" />
                          </td>
                          <td>
                            <span className="skeleton wide" />
                          </td>
                          <td>
                            <span className="skeleton" />
                          </td>
                          <td />
                        </tr>
                      ))
                    : data?.items.map((item) => (
                        <tr key={item.user_id}>
                          <td>
                            <strong>{item.user_id}</strong>
                          </td>
                          <td>
                            <div className="chips">
                              {item.matched_products.map((p) => (
                                <span key={p.product_id} title={p.product_name}>
                                  {p.lender} · {p.product_name}
                                </span>
                              ))}
                              {!item.matched_products.length && (
                                <span className="muted">
                                  {item.status === "processing"
                                    ? "Awaiting completed checks"
                                    : "No eligible products"}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <Status value={item.status} />
                          </td>
                          <td>
                            <button
                              className="row-link"
                              aria-label={`View decisions for ${item.user_id}`}
                              onClick={() => setSelected(item.user_id)}
                            >
                              View decisions
                              <ArrowRight size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
              {!loading && data?.items.length === 0 && (
                <div className="empty">
                  <Users />
                  <h3>No applicants match these filters</h3>
                  <p>Try another reference, status or lender product.</p>
                  <button
                    className="button outline"
                    onClick={() => update({ q: "", status: "", product: "" })}
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>
            <div className="pagination">
              <div className="pagination-summary" role="status">
                {loading
                  ? "Loading applicants…"
                  : `${fmt(data?.total ? (page - 1) * size + 1 : 0)}–${fmt(Math.min(page * size, data?.total || 0))} of ${fmt(data?.total || 0)} applicants`}
                <label>
                  Per page
                  <select
                    value={size}
                    onChange={(e) => update({ size: e.target.value })}
                  >
                    {[25, 50, 100].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
              <nav aria-label="Applicant pages">
                <button
                  disabled={loading || page <= 1}
                  onClick={() => update({ page: "1" }, false)}
                >
                  First
                </button>
                <button
                  aria-label="Previous page"
                  disabled={loading || page <= 1}
                  onClick={() => update({ page: String(page - 1) }, false)}
                >
                  <ChevronLeft size={16} />
                </button>
                {numbers.map((n, i) => (
                  <span key={n}>
                    {i > 0 && n - numbers[i - 1] > 1 && (
                      <span className="ellipsis">…</span>
                    )}
                    <button
                      aria-current={n === page ? "page" : undefined}
                      disabled={loading}
                      onClick={() => update({ page: String(n) }, false)}
                    >
                      {n}
                    </button>
                  </span>
                ))}
                <button
                  aria-label="Next page"
                  disabled={loading || page >= pages}
                  onClick={() => update({ page: String(page + 1) }, false)}
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  disabled={loading || page >= pages}
                  onClick={() => update({ page: String(pages) }, false)}
                >
                  Last
                </button>
              </nav>
              <form
                className="page-jump"
                onSubmit={(e) => {
                  e.preventDefault();
                  update(
                    {
                      page: String(
                        Math.max(1, Math.min(pages, Number(jump) || 1)),
                      ),
                    },
                    false,
                  );
                  setJump("");
                }}
              >
                <label htmlFor="jump">Go to page</label>
                <input
                  id="jump"
                  inputMode="numeric"
                  type="number"
                  min="1"
                  max={pages}
                  value={jump}
                  onChange={(e) => setJump(e.target.value)}
                />
                <button disabled={loading}>Go</button>
              </form>
            </div>
          </section>
          {run?.status === "completed" && (
            <section className="panel notification">
              <div>
                <h2>Notification preview</h2>
                <p>
                  Preview the eligible matches and distinct applicant email
                  addresses for this file.
                </p>
                {preview && (
                  <p role="status">
                    <strong>
                      {fmt(preview.eligible_matches)} eligible matches
                    </strong>{" "}
                    across {fmt(preview.distinct_email_addresses)} email
                    addresses.
                  </p>
                )}
              </div>
              <button
                className="button outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setPreview(
                      await request(`/api/runs/${runId}/notification-preview`, {
                        method: "POST",
                        body: "{}",
                      }),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Preview notifications
              </button>
            </section>
          )}
          <NotificationSummary runId={runId} />
        </>
      )}
      {selected && (
        <ApplicantDrawer
          runId={runId}
          userId={selected}
          close={() => setSelected(null)}
        />
      )}
    </>
  );
}
function NotificationSummary({ runId }: { runId: string }) {
  const { request } = useWorkspace(),
    [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    const c = new AbortController();
    const load = () =>
      void request<Record<string, number>>(`/api/runs/${runId}/notifications`, {
        signal: c.signal,
      })
        .then((d) => {
          if (!c.signal.aborted) setCounts(d);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 6000);
    return () => {
      c.abort();
      clearInterval(t);
    };
  }, [request, runId]);
  return (
    counts && (
      <section
        className="notification-summary"
        aria-label="Notification status"
      >
        <strong>Notifications</strong>
        <span>Preview ready: {fmt(counts.preview_ready)}</span>
        <span>Sent: {fmt(counts.sent)}</span>
        <span>Pending: {fmt(counts.pending)}</span>
        <span>Needs attention: {fmt(counts.needs_attention)}</span>
      </section>
    )
  );
}
function ApplicantDrawer({
  runId,
  userId,
  close,
}: {
  runId: string;
  userId: string;
  close: () => void;
}) {
  const { request } = useWorkspace(),
    dialog = useRef<HTMLDialogElement>(null),
    [data, setData] = useState<(Applicant & { results: Result[] }) | null>(
      null,
    ),
    [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current!,
      previous = document.activeElement as HTMLElement;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void request<Applicant & { results: Result[] }>(
      `/api/runs/${runId}/applicant?user_id=${encodeURIComponent(userId)}`,
      { signal: c.signal },
    )
      .then((d) => {
        if (!c.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError((e as Error).message);
      });
    return () => c.abort();
  }, [request, runId, userId]);
  return (
    <dialog
      ref={dialog}
      className="drawer"
      aria-labelledby="applicant-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="drawer-content">
        <div className="section-title">
          <div>
            <p className="eyebrow">APPLICANT DECISIONS</p>
            <h2 id="applicant-title">{userId}</h2>
          </div>
          <button
            autoFocus
            className="icon-button"
            onClick={close}
            aria-label="Close applicant details"
          >
            <X />
          </button>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {!data && !error && <p role="status">Loading lender decisions…</p>}
        {data && (
          <>
            <div className="drawer-summary">
              <Status value={data.status} />
              <span>{data.results.length} lender decisions saved</span>
            </div>
            {data.status === "processing" && (
              <p className="notice">
                Some lender checks are still processing. Close and reopen to
                refresh these decisions.
              </p>
            )}
            {data.results.map((result) => (
              <article className="decision-card" key={result.result_id}>
                <div className="section-title">
                  <div>
                    <h3>{result.lender}</h3>
                    <p>{result.product_name}</p>
                  </div>
                  <Status value={result.decision} />
                </div>
                {result.advertised_rate && (
                  <p className="rate">
                    Advertised rate: {result.advertised_rate}
                  </p>
                )}
                <div className="reasons">
                  {result.reasons.map((reason, i) => (
                    <div key={i}>
                      <div>
                        <strong>{reason.criterion.replaceAll("_", " ")}</strong>
                        <span className={`reason-status ${reason.status}`}>
                          {reason.status}
                        </span>
                      </div>
                      <p>
                        {reason.message}
                        {reason.observed_value !== undefined &&
                          ` Observed: ${reason.observed_value}.`}
                        {reason.required_value &&
                          ` Required: ${reason.required_value}.`}
                        {reason.minimum !== undefined &&
                          ` Minimum: ${reason.minimum}${reason.currency ? ` ${reason.currency}` : ""}.`}
                        {reason.maximum !== undefined &&
                          ` Maximum: ${reason.maximum}.`}
                        {reason.preferred_minimum !== undefined &&
                          ` Preferred minimum: ${reason.preferred_minimum}.`}
                      </p>
                    </div>
                  ))}
                </div>
                <a href={result.source_url} target="_blank" rel="noreferrer">
                  View official source
                  <ArrowRight size={14} />
                </a>
                <details className="audit">
                  <summary>Policy and audit details</summary>
                  <dl>
                    <dt>Policy snapshot</dt>
                    <dd>{result.snapshot_id}</dd>
                    <dt>Rule version</dt>
                    <dd>{result.rule_version}</dd>
                    <dt>Source observed</dt>
                    <dd>{date(result.observed_at)}</dd>
                  </dl>
                </details>
              </article>
            ))}
            {!data.results.length && (
              <p>No lender decisions have been saved yet.</p>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
function Policies() {
  const { dashboard, pending, request, refresh } = useWorkspace(),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  return (
    <>
      <Heading title="Policies">
        Review the lender criteria used for new applicant analyses.
      </Heading>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="section-title">
        <div>
          <h2>Active catalogue</h2>
          <p>Each analysis keeps the policy versions active when it starts.</p>
        </div>
        <span className="count">
          {dashboard?.products.length || 0} products
        </span>
      </div>
      <section className="policy-grid">
        {dashboard?.products.map((p) => (
          <article className="panel policy-card" key={p.product_id}>
            <div className="lender-icon">
              <Banknote size={22} />
            </div>
            <h3>{p.lender}</h3>
            <p>{p.product_name}</p>
            <div className="rate">
              <span>Advertised rate</span>
              <strong>
                {p.advertised_rate || "Not published in this source"}
              </strong>
            </div>
            <p className="small muted">
              {p.extraction_status === "approved"
                ? `Approved source${p.observed_at ? ` · observed ${date(p.observed_at)}` : ""}`
                : "Source requires review"}
            </p>
            <a href={p.product_url} target="_blank" rel="noreferrer">
              Official eligibility source
              <ArrowRight size={14} />
            </a>
          </article>
        ))}
      </section>
      <div className="section-title policy-review-title">
        <div>
          <h2>Changes awaiting approval</h2>
          <p>
            Review the source and proposed criteria before applying a new policy
            to future analyses.
          </p>
        </div>
        <span className="count">{pending.length} pending</span>
      </div>
      {pending.length ? (
        pending.map((p) => (
          <article className="panel pending-policy" key={p.snapshot_id}>
            <div className="section-title">
              <div>
                <h3>
                  {p.lender} · {p.product_name}
                </h3>
                <p>Source observed {date(p.observed_at)}</p>
              </div>
              <span className="status review">Needs approval</span>
            </div>
            {p.advertised_rate && (
              <p className="rate">Advertised rate: {p.advertised_rate}</p>
            )}
            <dl className="policy-rules">
              {Object.entries(p.rules)
                .filter(
                  ([key]) =>
                    !["version", "incomplete_eligibility"].includes(key),
                )
                .map(([key, rule]) => (
                  <div key={key}>
                    <dt>{key.replaceAll("_", " ")}</dt>
                    <dd>
                      {rule.kind === "unknown"
                        ? "Not specified — requires review"
                        : `${rule.status || rule.min || ""}${rule.max ? `–${rule.max}` : ""}${rule.currency ? ` ${rule.currency}` : ""}${rule.kind === "preferred" ? " preferred" : ""}${rule.location_dependent ? " · varies by location" : ""}`}
                    </dd>
                  </div>
                ))}
            </dl>
            <details className="source">
              <summary>Review source evidence</summary>
              {p.rate_source_quote && (
                <blockquote>{p.rate_source_quote}</blockquote>
              )}
              <pre>{p.source_excerpt}</pre>
              <a href={p.source_url} target="_blank" rel="noreferrer">
                Open official source
                <ArrowRight size={14} />
              </a>
              {p.reviewer_note && (
                <details className="audit">
                  <summary>Extraction notes</summary>
                  <p>{p.reviewer_note}</p>
                </details>
              )}
            </details>
            <div className="approval">
              <p>Approval applies to future analyses.</p>
              <button
                className="button primary"
                disabled={!!busy}
                onClick={async () => {
                  setBusy(p.snapshot_id);
                  setMessage("");
                  try {
                    await request(`/api/policies/${p.snapshot_id}/approve`, {
                      method: "POST",
                      body: "{}",
                    });
                    setMessage(
                      `${p.lender} policy approved. New analyses will use this version.`,
                    );
                    await refresh();
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {busy === p.snapshot_id ? "Approving…" : "Approve criteria"}
                <Check size={16} />
              </button>
            </div>
          </article>
        ))
      ) : (
        <div className="panel empty">
          <ShieldCheck />
          <h3>No policy changes awaiting approval</h3>
          <p>New source changes will appear here for your review.</p>
        </div>
      )}
    </>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <Provider>
        <Shell />
      </Provider>
    </BrowserRouter>
  );
}
