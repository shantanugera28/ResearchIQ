import React, { useState, useRef } from "react";
import "./App.css";

// ─── Constants ───────────────────────────────────────────────────────────────

const PROJECT_NAME   = "ResearchIQ";
const PROJECT_FULL   = "Agentic Research Intelligence";
const PROJECT_TAGLINE = "Multi-source agentic research powered by LangGraph orchestration, Tavily web search, arXiv retrieval, Groq reasoning, and PydanticAI structured outputs.";

const SUGGESTED_QUERIES = [
  "Anomaly detection using deep learning",
  "Retrieval-Augmented Generation (RAG) architectures",
  "Transformer models for computer vision",
  "Reinforcement learning from human feedback (RLHF)",
  "Large language model fine-tuning techniques",
  "Graph neural networks for drug discovery",
];

const STEPS = [
  { key: "web",       label: "Web Search",        detail: "Tavily · 6 sources · deep crawl",   icon: "🌐" },
  { key: "arxiv",     label: "Paper Retrieval",    detail: "arXiv API · up to 5 papers",        icon: "📄" },
  { key: "synthesize",label: "LLM Synthesis",      detail: "Groq llama-3.3-70b · reasoning",    icon: "🧠" },
  { key: "validate",  label: "Output Validation",  detail: "PydanticAI · schema enforcement",   icon: "✅" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

const AgentStep = ({ step, status, elapsed }) => {
  const icons = { done: "✓", active: "◉", pending: "○", error: "✗" };
  return (
    <div className={`agent-step ${status}`}>
      <span className="step-icon">{icons[status]}</span>
      <div className="step-body">
        <span className="step-label">{step.icon} {step.label}</span>
        <span className="step-detail">{step.detail}</span>
      </div>
      {status === "done" && elapsed != null && (
        <span className="step-elapsed">{elapsed}s</span>
      )}
      {status === "active" && (
        <span className="step-elapsed running">running</span>
      )}
    </div>
  );
};

const MetricBadge = ({ icon, label, value, color }) => (
  <div className="metric-badge" style={{ borderColor: color + "33" }}>
    <span className="metric-icon">{icon}</span>
    <div className="metric-body">
      <span className="metric-value" style={{ color }}>{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  </div>
);

const PaperCard = ({ paper, index }) => (
  <div className="paper-card">
    <span className="paper-index">#{index + 1}</span>
    <h4>{paper.title}</h4>
    <p className="paper-summary">{paper.summary}</p>
    <p className="paper-relevance">↳ {paper.relevance}</p>
    {paper.source && (
      <a href={paper.source} target="_blank" rel="noreferrer" className="paper-link">
        View Source →
      </a>
    )}
  </div>
);

const ConfidenceMeter = ({ value }) => {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? "#4ade80" : pct >= 50 ? "#facc15" : "#f87171";
  const label = pct >= 75 ? "High" : pct >= 50 ? "Medium" : "Low";
  return (
    <div className="confidence-meter">
      <span className="confidence-label">Confidence</span>
      <div className="confidence-bar-track">
        <div className="confidence-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="confidence-pct" style={{ color }}>{pct}% <span className="confidence-tier">({label})</span></span>
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [query, setQuery]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [steps, setSteps]       = useState([]);          // "pending"|"active"|"done"|"error"
  const [elapsed, setElapsed]   = useState([]);          // per-step seconds
  const [totalTime, setTotalTime] = useState(null);
  const [report, setReport]     = useState(null);
  const [metrics, setMetrics]   = useState(null);
  const [error, setError]       = useState(null);

  const startRef   = useRef(null);
  const stepRef    = useRef(null);

  // Step timing: advances active step every ~N ms
  const startStepTimer = () => {
    const stepDelays = [1300, 2600, 5200, 8000]; // cumulative ms when each step completes
    const stepStarts = [0, 1300, 2600, 5200];

    stepRef.current = [];
    const stepElapsed = [null, null, null, null];

    STEPS.forEach((_, i) => {
      // mark active
      const activeT = setTimeout(() => {
        setSteps(prev => {
          const next = [...prev];
          next[i] = "active";
          return next;
        });
      }, stepStarts[i]);

      // mark done
      const doneT = setTimeout(() => {
        const secs = ((stepDelays[i] - stepStarts[i]) / 1000).toFixed(1);
        stepElapsed[i] = secs;
        setElapsed([...stepElapsed]);
        setSteps(prev => {
          const next = [...prev];
          next[i] = "done";
          return next;
        });
      }, stepDelays[i]);

      stepRef.current.push(activeT, doneT);
    });
  };

  const clearStepTimers = () => {
    if (stepRef.current) stepRef.current.forEach(clearTimeout);
  };

  const handleResearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setReport(null);
    setError(null);
    setMetrics(null);
    setTotalTime(null);
    setSteps(["pending", "pending", "pending", "pending"]);
    setElapsed([null, null, null, null]);

    startRef.current = Date.now();
    startStepTimer();

    try {
      const res  = await fetch("/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      const total = ((Date.now() - startRef.current) / 1000).toFixed(1);

      clearStepTimers();
      setTotalTime(total);

      if (data.success) {
        setSteps(["done", "done", "done", "done"]);
        setElapsed(e => e.map(v => v ?? "—"));
        setReport(data.report);
        setMetrics({
          sources: data.report.papers?.length ?? 0,
          findings: data.report.key_findings?.length ?? 0,
          confidence: Math.round((data.report.confidence ?? 0) * 100),
          time: total,
        });
      } else {
        setError(data.error || "Unknown error from agent.");
        setSteps(prev => prev.map(s => s === "active" ? "error" : s === "pending" ? "error" : s));
      }
    } catch (e) {
      clearStepTimers();
      setError("Could not reach the backend. Make sure uvicorn is running on port 8000.");
      setSteps(["done", "done", "error", "error"]);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setQuery(""); setReport(null); setError(null);
    setSteps([]); setElapsed([]); setMetrics(null); setTotalTime(null);
  };

  return (
    <div className="app">

      {/* ── Header ── */}
      <header className="header">
        <div className="header-badge">AGENTIC WORKFLOW · LANGGRAPH + PYDANTICAI</div>
        <h1 className="title">
          <span className="title-brand">{PROJECT_NAME}</span>
          <span className="title-sub">{PROJECT_FULL}</span>
        </h1>
        <p className="subtitle">{PROJECT_TAGLINE}</p>

        {/* Stack pills */}
        <div className="stack-pills">
          {["LangGraph", "PydanticAI", "Groq llama-3.3-70b", "Tavily Search", "arXiv API", "FastAPI"].map(t => (
            <span key={t} className="stack-pill">{t}</span>
          ))}
        </div>
      </header>

      <main className="main">

        {/* ── Search ── */}
        <div className="search-box">
          <textarea
            className="query-input"
            placeholder='Ask anything research-related, e.g. "How do vision transformers compare to CNNs for image classification?"'
            value={query}
            onChange={e => setQuery(e.target.value)}
            rows={3}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleResearch(); } }}
          />
          <div className="search-actions">
            {report && <button className="reset-btn" onClick={handleReset}>← New Query</button>}
            <button className="search-btn" onClick={handleResearch} disabled={loading || !query.trim()}>
              {loading ? "Agent Running…" : "Run Agent →"}
            </button>
          </div>
        </div>

        {/* ── Suggestions ── */}
        {!loading && !report && (
          <div className="suggestions">
            <span className="suggestions-label">Example queries:</span>
            {SUGGESTED_QUERIES.map(q => (
              <button key={q} className="suggestion-chip" onClick={() => setQuery(q)}>{q}</button>
            ))}
          </div>
        )}

        {/* ── Pipeline ── */}
        {steps.length > 0 && (
          <div className="pipeline">
            <div className="pipeline-header">
              <h3 className="pipeline-title">AGENT EXECUTION TRACE</h3>
              {totalTime && <span className="pipeline-total">Total: {totalTime}s</span>}
            </div>
            <div className="pipeline-steps">
              {STEPS.map((s, i) => (
                <AgentStep key={s.key} step={s} status={steps[i] || "pending"} elapsed={elapsed[i]} />
              ))}
            </div>
            <div className="pipeline-arch">
              START → search_web → fetch_arxiv → synthesize → validate_output → END
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {error && <div className="error-box">⚠ {error}</div>}

        {/* ── Metrics Bar ── */}
        {metrics && (
          <div className="metrics-bar">
            <MetricBadge icon="🌐" label="Web Sources" value={`6`}                          color="#38bdf8" />
            <MetricBadge icon="📄" label="Papers Found" value={metrics.sources}             color="#818cf8" />
            <MetricBadge icon="💡" label="Key Findings" value={metrics.findings}            color="#facc15" />
            <MetricBadge icon="🎯" label="Confidence"   value={`${metrics.confidence}%`}   color="#4ade80" />
            <MetricBadge icon="⚡" label="Total Time"   value={`${metrics.time}s`}          color="#fb923c" />
          </div>
        )}

        {/* ── Report ── */}
        {report && (
          <div className="report">
            <div className="report-header">
              <div>
                <h2 className="report-title">Intelligence Report</h2>
                <p className="report-query">"{report.query}"</p>
              </div>
              <ConfidenceMeter value={report.confidence} />
            </div>

            <section className="report-section">
              <h3>EXECUTIVE SUMMARY</h3>
              <p>{report.overview}</p>
            </section>

            <section className="report-section">
              <h3>KEY FINDINGS</h3>
              <ul className="findings-list">
                {report.key_findings.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </section>

            <section className="report-section">
              <h3>RETRIEVED SOURCES & PAPERS</h3>
              <div className="papers-grid">
                {report.papers.map((p, i) => <PaperCard key={i} paper={p} index={i} />)}
              </div>
            </section>

            <div className="report-two-col">
              <section className="report-section">
                <h3>CURRENT LIMITATIONS</h3>
                <p>{report.limitations}</p>
              </section>
              <section className="report-section">
                <h3>FUTURE DIRECTIONS</h3>
                <p>{report.future_directions}</p>
              </section>
            </div>

            <div className="arch-note">
              <strong>Pipeline:</strong>&nbsp;
              User Query → <em>LangGraph</em> [ Tavily Web Search → arXiv Retrieval → Groq LLM Synthesis → PydanticAI Validation ] → Structured Report
              &nbsp;|&nbsp; <strong>Model:</strong> llama-3.3-70b-versatile &nbsp;|&nbsp; <strong>Orchestration:</strong> LangGraph StateGraph
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        Built by Shantanu Gera · VIT Chennai · B.Tech CSE 2026 &nbsp;·&nbsp;
        <span className="footer-stack">LangGraph · PydanticAI · Groq · FastAPI · React</span>
      </footer>
    </div>
  );
}
