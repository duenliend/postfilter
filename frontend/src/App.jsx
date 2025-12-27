import { useEffect, useMemo, useState } from "react";

const STATUS_LABELS = {
  idle: "Idle",
  running: "Running",
  extracting: "Extracting",
  awaiting_manual: "Manual input required",
  summarizing: "Summarizing",
  classifying: "Classifying",
  completed: "Completed",
  error: "Error"
};
const STATUS_STEPS = [
  { key: "extracting", label: "Extract", note: "Fetch + text extraction" },
  { key: "awaiting_manual", label: "Manual", note: "Paste failed rows" },
  { key: "summarizing", label: "Summarize", note: "Batch summary JSON" },
  { key: "classifying", label: "Classify", note: "Codebook relevance" },
  { key: "completed", label: "Export", note: "Workbook ready" }
];

function formatStatus(status) {
  return STATUS_LABELS[status] || status || "Unknown";
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function getNormalizedStatus(status) {
  if (status === "running") return "extracting";
  return status || "idle";
}

function getHostname(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\\./, "");
  } catch (error) {
    return "";
  }
}

function getTitleLabel(row) {
  return row.title || getHostname(row.url) || row.id || "Untitled article";
}

export default function App() {
  const [datasetId, setDatasetId] = useState("");
  const [columns, setColumns] = useState([]);
  const [urlColumn, setUrlColumn] = useState("");
  const [status, setStatus] = useState("idle");
  const [rows, setRows] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [manualTexts, setManualTexts] = useState({});
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    if (!datasetId) return;
    let timer = null;
    const poll = async () => {
      try {
        const res = await fetch(`/api/status?datasetId=${datasetId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Status fetch failed");
        setStatus(data.status);
        setRows(data.rows || []);
        setRowCount(data.rowCount || 0);
        setError(data.error || "");
      } catch (err) {
        setError(err.message);
      }
    };
    poll();
    timer = setInterval(poll, 3000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [datasetId]);

  const extractionCounts = useMemo(() => countBy(rows, "extraction_status"), [rows]);
  const failedRows = useMemo(
    () => rows.filter((row) => row.extraction_status === "FAILED"),
    [rows]
  );
  const normalizedStatus = useMemo(() => getNormalizedStatus(status), [status]);
  const statusStepIndex = useMemo(
    () => STATUS_STEPS.findIndex((step) => step.key === normalizedStatus),
    [normalizedStatus]
  );
  const progressStats = useMemo(() => {
    const ok = extractionCounts.OK || 0;
    const manual = extractionCounts.MANUAL || 0;
    const failed = extractionCounts.FAILED || 0;
    const dismissed = extractionCounts.DISMISSED || 0;
    const pending = extractionCounts.PENDING || 0;
    const running = extractionCounts.RUNNING || 0;
    const done = ok + manual + dismissed;
    const total = rowCount || rows.length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    return {
      ok,
      manual,
      failed,
      dismissed,
      pending,
      running,
      done,
      total,
      percent
    };
  }, [extractionCounts, rowCount, rows.length]);
  const statusDetail = useMemo(() => {
    const { done, failed, pending, running, total, dismissed } = progressStats;

    switch (normalizedStatus) {
      case "idle":
        return "Upload a file to start the pipeline.";
      case "extracting":
        return `Extracting: ${done}/${total} done. Running ${running}, pending ${pending}, failed ${failed}, dismissed ${dismissed}.`;
      case "awaiting_manual":
        return `Waiting for manual text: ${failed} failed rows. Done ${done}/${total}.`;
      case "summarizing":
        return `Summarizing ${total} articles via Batch API. Extracted ${done}/${total}.`;
      case "classifying":
        return `Classifying relevance for ${total} articles.`;
      case "completed":
        return `Completed: ${total}/${total} processed. Ready to export Excel.`;
      case "error":
        return error ? `Error: ${error}` : "Pipeline error. Check backend logs.";
      default:
        return "Working...";
    }
  }, [normalizedStatus, progressStats, error]);

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setDatasetId(data.datasetId);
      setColumns(data.columns || []);
      setUrlColumn(data.urlColumn || "");
      setRowCount(data.rowCount || 0);
      setFileName(file.name);
      setStatus("idle");
      setRows([]);
      setManualTexts({});
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleStart = async () => {
    if (!datasetId || !urlColumn) return;
    setError("");
    try {
      const res = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId, urlColumn })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Start failed");
      setStatus(data.status || "running");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleManualSubmit = async () => {
    if (!datasetId) return;
    const items = failedRows
      .map((row) => ({ id: row.id, text: manualTexts[row.id] || "" }))
      .filter((item) => item.text.trim().length > 0);
    if (!items.length) return;
    setError("");
    try {
      const res = await fetch("/api/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId, items })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Manual submit failed");
      setStatus(data.status || "running");
      setManualTexts((prev) => {
        const next = { ...prev };
        items.forEach((item) => {
          delete next[item.id];
        });
        return next;
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDismiss = async (rowId) => {
    if (!datasetId || !rowId) return;
    setError("");
    try {
      const res = await fetch("/api/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId, items: [{ id: rowId, dismissed: true }] })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Dismiss failed");
      setStatus(data.status || "running");
      setManualTexts((prev) => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTitleOnly = async (rowId) => {
    if (!datasetId || !rowId) return;
    setError("");
    try {
      const res = await fetch("/api/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId, items: [{ id: rowId, titleOnly: true }] })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Title-only failed");
      setStatus(data.status || "running");
      setManualTexts((prev) => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDownload = () => {
    if (!datasetId) return;
    window.location.href = `/api/export?datasetId=${datasetId}`;
  };

  const handleTitleOnlyAll = async () => {
    if (!datasetId) return;
    if (!failedRows.length) return;
    setError("");
    try {
      const items = failedRows.map((row) => ({ id: row.id, titleOnly: true }));
      const res = await fetch("/api/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId, items })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Title-only classify failed");
      setStatus(data.status || "running");
      setManualTexts({});
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="app">
      <div className="background" aria-hidden="true"></div>
      <section className="status-bar">
        <div className="status-bar__top">
          <div className="status-bar__summary">
            <span className={`status-chip ${normalizedStatus}`}>Progress</span>
            <span className="status-detail">{statusDetail}</span>
          </div>
          <div className="status-bar__counts">
            <span>OK {progressStats.ok}</span>
            <span>RUN {progressStats.running}</span>
            <span>PEND {progressStats.pending}</span>
            <span>FAIL {progressStats.failed}</span>
            <span>MAN {progressStats.manual}</span>
            <span>DISM {progressStats.dismissed}</span>
          </div>
        </div>
        <div className={`status-steps ${normalizedStatus === "error" ? "is-error" : ""}`}>
          {STATUS_STEPS.map((step, index) => {
            let state = "pending";
            if (statusStepIndex >= 0) {
              if (index < statusStepIndex) state = "done";
              if (index === statusStepIndex) state = "active";
            }
            if (normalizedStatus === "completed" && index === STATUS_STEPS.length - 1) {
              state = "done";
            }
            return (
              <div key={step.key} className={`status-step ${state}`}>
                <span className="status-dot"></span>
                <div>
                  <p className="status-step__label">{step.label}</p>
                  <p className="status-step__note">{step.note}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <header className="hero">
        <div className="hero-title">
          <p className="eyebrow">Local Leeds Index Pipeline</p>
          <h1>PostFilter</h1>
          <p className="subtitle">
            Extract article text, run batch summaries, and classify protest events with the Leeds Index codebook.
          </p>
        </div>
        <div className="hero-card">
          <div className="hero-stats">
            <div>
              <p className="stat-label">Dataset</p>
              <p className="stat-value">{fileName || "No file"}</p>
            </div>
            <div>
              <p className="stat-label">Rows</p>
              <p className="stat-value">{rowCount || "-"}</p>
            </div>
            <div>
              <p className="stat-label">Status</p>
              <p className={`stat-value status ${status}`}>{formatStatus(status)}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="panel" style={{ animationDelay: "120ms" }}>
        <div className="panel-header">
          <div>
            <h2>1. Upload</h2>
            <p>CSV/XLSX with an Article URL column.</p>
          </div>
          <div className="panel-actions">
            <label className={`file-input ${uploading ? "disabled" : ""}`}>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(event) => handleUpload(event.target.files[0])}
                disabled={uploading}
              />
              {uploading ? "Uploading..." : "Choose File"}
            </label>
          </div>
        </div>
        {columns.length > 0 && (
          <div className="panel-body">
            <div className="field">
              <label>URL column</label>
              <select value={urlColumn} onChange={(event) => setUrlColumn(event.target.value)}>
                {columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn primary" onClick={handleStart} disabled={!urlColumn || status !== "idle"}>
              Start pipeline
            </button>
          </div>
        )}
      </section>

      <section className="panel" style={{ animationDelay: "220ms" }}>
        <div className="panel-header">
          <div>
            <h2>2. Progress</h2>
            <p>Detailed pipeline progress at a glance.</p>
          </div>
          <div className="pill-group">
            <span className="pill">Total: {progressStats.total || 0}</span>
            <span className="pill">Done: {progressStats.done || 0}</span>
            <span className="pill">Failed: {progressStats.failed || 0}</span>
          </div>
        </div>
        <div className="panel-body">
          {progressStats.total === 0 ? (
            <p className="muted">Upload a file to start progress tracking.</p>
          ) : (
            <div className="progress-summary">
              <div className="progress-grid">
                <div className="progress-card">
                  <p className="progress-label">Total rows</p>
                  <p className="progress-value">{progressStats.total}</p>
                </div>
                <div className="progress-card">
                  <p className="progress-label">Extracted</p>
                  <p className="progress-value">{progressStats.done}</p>
                </div>
                <div className="progress-card">
                  <p className="progress-label">Running</p>
                  <p className="progress-value">{progressStats.running}</p>
                </div>
                <div className="progress-card">
                  <p className="progress-label">Pending</p>
                  <p className="progress-value">{progressStats.pending}</p>
                </div>
                <div className="progress-card">
                  <p className="progress-label">Failed</p>
                  <p className="progress-value">{progressStats.failed}</p>
                </div>
                <div className="progress-card">
                  <p className="progress-label">Manual</p>
                  <p className="progress-value">{progressStats.manual}</p>
                </div>
                <div className="progress-card">
                  <p className="progress-label">Dismissed</p>
                  <p className="progress-value">{progressStats.dismissed}</p>
                </div>
              </div>
              <div className="progress-bar">
                <div className="progress-bar__fill" style={{ width: `${progressStats.percent}%` }}></div>
              </div>
              <div className="progress-meta">
                <p className="progress-note">
                  Extraction completion: {progressStats.percent}% ({progressStats.done}/{progressStats.total})
                </p>
                <p className="progress-note">{statusDetail}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {status === "awaiting_manual" && failedRows.length > 0 && (
        <section className="panel" style={{ animationDelay: "320ms" }}>
          <div className="panel-header">
            <div>
              <h2>3. Manual paste</h2>
              <p>Paste article text for failed extractions, then continue.</p>
            </div>
            <div className="panel-actions">
              <button className="btn subtle" type="button" onClick={handleTitleOnlyAll}>
                Assess titles
              </button>
              <button className="btn" onClick={handleManualSubmit}>
                Submit manual text
              </button>
            </div>
          </div>
          <div className="panel-body manual-list">
            {failedRows.map((row) => (
              <div key={row.id} className="manual-item">
                <div>
                  <p className="manual-label">{getTitleLabel(row)}</p>
                  <p className="manual-id mono">{row.id}</p>
                  {row.url ? (
                    <a className="manual-link" href={row.url} target="_blank" rel="noreferrer">
                      {row.url}
                    </a>
                  ) : (
                    <p className="manual-url mono">Missing URL</p>
                  )}
                  <div className="manual-actions">
                    <button className="btn subtle" type="button" onClick={() => handleTitleOnly(row.id)}>
                      Use title only
                    </button>
                    <button className="btn subtle" type="button" onClick={() => handleDismiss(row.id)}>
                      Dismiss article
                    </button>
                  </div>
                </div>
                <textarea
                  placeholder="Paste full article text"
                  value={manualTexts[row.id] || ""}
                  onChange={(event) =>
                    setManualTexts((prev) => ({
                      ...prev,
                      [row.id]: event.target.value
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel" style={{ animationDelay: "420ms" }}>
        <div className="panel-header">
          <div>
            <h2>4. Export</h2>
            <p>Download the enriched Excel workbook when complete.</p>
          </div>
          <button className="btn primary" onClick={handleDownload} disabled={status !== "completed"}>
            Download Excel
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}
