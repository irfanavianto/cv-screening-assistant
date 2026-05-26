// pages/index.js
import { useState, useRef } from 'react';
import Head from 'next/head';

// ─── Lightweight markdown renderer (bold, italic, paragraphs) ───
function renderMarkdown(text) {
  if (!text) return null;
  return text
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map((para, i) => {
      // Parse inline: **bold** and *italic*
      const parts = [];
      const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
      let last = 0, match;
      while ((match = regex.exec(para)) !== null) {
        if (match.index > last) parts.push(para.slice(last, match.index));
        if (match[1]) parts.push(<strong key={match.index}>{match[1]}</strong>);
        else if (match[2]) parts.push(<em key={match.index}>{match[2]}</em>);
        last = match.index + match[0].length;
      }
      if (last < para.length) parts.push(para.slice(last));
      return (
        <p key={i} style={{ margin: i === 0 ? 0 : '12px 0 0', lineHeight: 1.85 }}>
          {parts}
        </p>
      );
    });
}

// ─── Shared constants ────────────────────────────────────────
const CV_CHAR_LIMIT = 6000;

// ─── PDF text extraction (client-side via pdf.js) ──────────────
async function extractTextFromPDF(file) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(' ') + '\n';
  }
  return text.trim();
}

// ─── Sub-components ────────────────────────────────────────────

function ThemeToggle({ theme, toggleTheme }) {
  return (
    <button className="btn btn-ghost" onClick={toggleTheme} title="Toggle theme">
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}

function StepIndicator({ current }) {
  const steps = [
    { n: 1, label: 'Job Description' },
    { n: 2, label: 'Hiring Criteria' },
    { n: 3, label: 'Upload CV' },
    { n: 4, label: 'Results' },
  ];
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <>
          <div
            key={s.n}
            className={`step ${current === s.n ? 'active' : current > s.n ? 'done' : ''}`}
          >
            <div className="step-num">
              {current > s.n ? '✓' : s.n}
            </div>
            <span>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div className="step-line" key={`line-${i}`} />}
        </>
      ))}
    </div>
  );
}

function ConfidenceBadge({ level }) {
  return (
    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: `var(--conf-${level}, var(--text-faint))` }}>
      <span className={`conf-dot conf-${level}`} />
      {level}
    </span>
  );
}

function MandatoryCard({ item }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 16px',
        borderRadius: 'var(--radius-sm)',
        background: item.pass ? 'var(--pass-bg)' : 'var(--fail-bg)',
        border: `1px solid ${item.pass ? 'var(--pass)' : 'var(--fail)'}`,
        marginBottom: 10,
      }}
    >
      <div style={{ fontSize: '1.1rem', marginTop: 1 }}>{item.pass ? '✅' : '❌'}</div>
      <div style={{ flex: 1 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
          <strong style={{ fontSize: '0.9rem' }}>{item.skill}</strong>
          <span
            style={{
              fontSize: '0.7rem',
              padding: '1px 7px',
              borderRadius: 99,
              background: 'var(--bg-subtle)',
              color: 'var(--text-muted)',
            }}
          >
            {item.type}
          </span>
          <ConfidenceBadge level={item.confidence} />
        </div>
        <p style={{ fontSize: '0.82rem', margin: 0 }}>{item.evidence}</p>
      </div>
    </div>
  );
}

function NiceToHaveCard({ item }) {
  const pct = item.weight > 0 ? Math.round((item.score / item.weight) * 100) : 0;
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border)',
        marginBottom: 10,
      }}
    >
      <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
        <div className="flex items-center gap-2">
          <strong style={{ fontSize: '0.9rem' }}>{item.skill}</strong>
          <span
            style={{
              fontSize: '0.7rem',
              padding: '1px 7px',
              borderRadius: 99,
              background: 'var(--bg-card)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {item.type}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ConfidenceBadge level={item.confidence} />
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            weight: <strong style={{ color: 'var(--text)' }}>{item.weight}</strong>
          </span>
          <span style={{ fontWeight: 700, color: item.score > 0 ? 'var(--pass)' : 'var(--text-faint)' }}>
            +{item.score}
          </span>
        </div>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%`, background: item.score > 0 ? 'var(--pass)' : 'var(--border)' }} />
      </div>
      <p style={{ fontSize: '0.78rem', marginTop: 6, marginBottom: 0 }}>{item.evidence}</p>
    </div>
  );
}

function QualitativeCard({ item }) {
  const color = { STRONG: 'var(--strong)', MODERATE: 'var(--moderate)', WEAK: 'var(--weak)' }[item.rating];
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border)',
        marginBottom: 8,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
        <strong style={{ fontSize: '0.88rem' }}>{item.dimension}</strong>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color }}>{item.rating}</span>
      </div>
      <p style={{ fontSize: '0.82rem', margin: 0 }}>{item.evidence}</p>
    </div>
  );
}

function GapCard({ item }) {
  const colors = {
    BLOCKER: { bg: 'var(--blocker-bg)', border: 'var(--fail)', text: 'var(--fail)' },
    'RAMP-UP': { bg: 'var(--rampup-bg)', border: 'var(--warn)', text: 'var(--warn)' },
    MINOR: { bg: 'var(--minor-bg)', border: 'var(--pass)', text: 'var(--pass)' },
  };
  const c = colors[item.severity] || colors.MINOR;
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 'var(--radius-sm)',
        background: c.bg,
        border: `1px solid ${c.border}`,
        marginBottom: 8,
      }}
    >
      <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
        <strong style={{ fontSize: '0.88rem' }}>{item.skill}</strong>
        <span
          className="badge"
          style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
        >
          {item.severity}
        </span>
      </div>
      <p style={{ fontSize: '0.82rem', margin: 0 }}>{item.note}</p>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function Home({ theme, toggleTheme }) {
  const [step, setStep] = useState(1);

  // Step 1 — JD
  const [jdText, setJdText] = useState('');
  const [parsedJD, setParsedJD] = useState(null);
  const [jdLoading, setJdLoading] = useState(false);
  const [jdError, setJdError] = useState('');

  // Step 2 — Criteria
  const [mandatory, setMandatory] = useState([]);
  const [niceToHave, setNiceToHave] = useState([]);
  const [additionalContext, setAdditionalContext] = useState('');
  const [newMandatory, setNewMandatory] = useState({ skill: '', type: 'technical' });
  const [newNice, setNewNice] = useState({ skill: '', type: 'technical', weight: 10 });

  // Step 3 — CV
  const [cvText, setCvText] = useState('');
  const [cvLoading, setCvLoading] = useState(false);
  const [cvFileName, setCvFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef();

  // Step 4 — Results
  const [result, setResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');

  // ── JD parsing ──
  async function handleExtractCriteria() {
    if (!jdText.trim()) return;
    setJdLoading(true);
    setJdError('');
    try {
      const res = await fetch('/api/parse-jd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: jdText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setParsedJD(data);
      setMandatory(data.mandatory || []);
      setNiceToHave(data.nicetohave || []);
      setStep(2);
    } catch (e) {
      setJdError(e.message || 'Failed to extract criteria. Please try again.');
    } finally {
      setJdLoading(false);
    }
  }

  // ── Criteria editing ──
  function totalWeight() {
    return niceToHave.reduce((s, i) => s + Number(i.weight), 0);
  }

  function addMandatory() {
    if (!newMandatory.skill.trim()) return;
    setMandatory([...mandatory, { ...newMandatory }]);
    setNewMandatory({ skill: '', type: 'technical' });
  }

  function addNiceToHave() {
    if (!newNice.skill.trim()) return;
    setNiceToHave([...niceToHave, { ...newNice, weight: Number(newNice.weight) }]);
    setNewNice({ skill: '', type: 'technical', weight: 10 });
  }

  // ── PDF extraction ──
  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCvFileName(file.name);
    setCvLoading(true);
    try {
      const text = await extractTextFromPDF(file);
      setCvText(text);
    } catch {
      setCvText('');
      alert('Could not extract text from PDF. Please paste the CV manually below.');
    } finally {
      setCvLoading(false);
    }
  }

  // ── Analysis ──
  async function handleAnalyze() {
    if (!cvText.trim()) return;
    setAnalyzing(true);
    setAnalyzeError('');
    setResult(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobDescription: jdText,
          mandatory,
          niceToHave,
          additionalContext,
          cvText,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      setStep(4);
    } catch (e) {
      setAnalyzeError(e.message || 'Analysis failed. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Render ──
  return (
    <>
      <Head>
        <title>CV Screening Assistant · Astro</title>
        <meta name="description" content="AI-powered CV screening copilot for Astro recruiters" />
      </Head>

      {/* ── Header ── */}
      <header
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          className="container"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 34, height: 34,
                borderRadius: 9,
                background: 'var(--primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1rem',
              }}
            >
              🚀
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>
                CV Screening Assistant
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Powered by Claude · Astro Internal Tool
              </div>
            </div>
          </div>
          <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
        </div>
      </header>

      {/* ── Main ── */}
      <main className="container" style={{ paddingTop: 40, paddingBottom: 80 }}>
        <StepIndicator current={step} />


        {/* ══ STEP 1 — Job Description ══ */}
        {step === 1 && (
          <div className="card fade-up">
            <div className="section-header">
              <div className="section-icon">📋</div>
              <div>
                <h2>Job Description</h2>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>
                  Copy the full text from any job posting (Kalibrr, LinkedIn, etc.) and paste below.
                  AI will automatically extract the hiring criteria for you.
                </p>
              </div>
            </div>

            <label>Job Description Text</label>
            <textarea
              placeholder={"Paste the full job description here…\n\nTip: On Kalibrr, select all text on the job page (Ctrl+A), copy (Ctrl+C), then paste here."}
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              style={{ minHeight: 220, marginBottom: 16 }}
            />

            {jdError && (
              <div className="warning-banner" style={{ marginBottom: 16 }}>
                ⚠️ {jdError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary"
                onClick={handleExtractCriteria}
                disabled={jdLoading || !jdText.trim()}
              >
                {jdLoading ? <><div className="spinner" /> Extracting criteria…</> : '⚡ Extract Criteria'}
              </button>
            </div>
          </div>
        )}


        {/* ══ STEP 2 — Hiring Criteria ══ */}
        {step === 2 && (
          <div className="fade-up">
            {parsedJD && (
              <div
                className="card"
                style={{ marginBottom: 20, background: 'var(--primary-light)', border: '1px solid var(--primary)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ color: 'var(--primary)' }}>✓ Criteria extracted from job description</strong>
                    <p style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
                      {parsedJD.job_title} · {parsedJD.company}
                    </p>
                  </div>
                  <button className="btn btn-ghost" onClick={() => setStep(1)}>← Edit JD</button>
                </div>
              </div>
            )}

            {/* Mandatory */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-header">
                <div className="section-icon">🔒</div>
                <div>
                  <h2>Mandatory Requirements</h2>
                  <p style={{ margin: 0, fontSize: '0.85rem' }}>Hard filters — candidate must pass all of these.</p>
                </div>
              </div>

              {mandatory.map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    background: 'var(--bg-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: 8,
                  }}
                >
                  <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 500 }}>{m.skill}</span>
                  <span
                    style={{
                      fontSize: '0.72rem', padding: '2px 8px', borderRadius: 99,
                      background: 'var(--bg-card)', color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {m.type}
                  </span>
                  <button className="btn btn-danger" onClick={() => setMandatory(mandatory.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input
                  type="text"
                  placeholder="Add requirement…"
                  value={newMandatory.skill}
                  onChange={(e) => setNewMandatory({ ...newMandatory, skill: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addMandatory()}
                  style={{ flex: 1 }}
                />
                <select
                  value={newMandatory.type}
                  onChange={(e) => setNewMandatory({ ...newMandatory, type: e.target.value })}
                  style={{ width: 140 }}
                >
                  <option value="technical">Technical</option>
                  <option value="education">Education</option>
                  <option value="experience">Experience</option>
                </select>
                <button className="btn btn-secondary" onClick={addMandatory}>+ Add</button>
              </div>
            </div>

            {/* Nice-to-Have */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-header">
                <div className="section-icon">⭐</div>
                <div>
                  <h2>Nice-to-Have</h2>
                  <p style={{ margin: 0, fontSize: '0.85rem' }}>
                    Weighted preferences. Total weight:{' '}
                    <strong style={{ color: totalWeight() === 100 ? 'var(--pass)' : 'var(--warn)' }}>
                      {totalWeight()}/100
                    </strong>
                    {totalWeight() !== 100 && ' — weights should sum to 100'}
                  </p>
                </div>
              </div>

              {niceToHave.map((n, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    background: 'var(--bg-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: 8,
                  }}
                >
                  <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 500 }}>{n.skill}</span>
                  <span
                    style={{
                      fontSize: '0.72rem', padding: '2px 8px', borderRadius: 99,
                      background: 'var(--bg-card)', color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {n.type}
                  </span>
                  <input
                    type="number"
                    value={n.weight}
                    min={1}
                    max={100}
                    onChange={(e) => {
                      const updated = [...niceToHave];
                      updated[i] = { ...updated[i], weight: Number(e.target.value) };
                      setNiceToHave(updated);
                    }}
                    style={{ width: 84, textAlign: 'center' }}
                  />
                  <button className="btn btn-danger" onClick={() => setNiceToHave(niceToHave.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input
                  type="text"
                  placeholder="Add nice-to-have…"
                  value={newNice.skill}
                  onChange={(e) => setNewNice({ ...newNice, skill: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addNiceToHave()}
                  style={{ flex: 1 }}
                />
                <select
                  value={newNice.type}
                  onChange={(e) => setNewNice({ ...newNice, type: e.target.value })}
                  style={{ width: 140 }}
                >
                  <option value="technical">Technical</option>
                  <option value="education">Education</option>
                  <option value="experience">Experience</option>
                </select>
                <input
                  type="number"
                  value={newNice.weight}
                  min={1}
                  max={100}
                  onChange={(e) => setNewNice({ ...newNice, weight: Number(e.target.value) })}
                  style={{ width: 84, textAlign: 'center' }}
                />
                <button className="btn btn-secondary" onClick={addNiceToHave}>+ Add</button>
              </div>
            </div>

            {/* Additional Context */}
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="section-header">
                <div className="section-icon">💬</div>
                <div>
                  <h2>Additional Context <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.8rem' }}>(optional)</span></h2>
                  <p style={{ margin: 0, fontSize: '0.85rem' }}>
                    Any qualitative nuance for this hire — e.g. "must be comfortable with ambiguity", "experience with local vendors preferred".
                  </p>
                </div>
              </div>
              <textarea
                placeholder="E.g. We need someone who can work independently and is comfortable with fast-changing priorities…"
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                style={{ minHeight: 80 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button
                className="btn btn-primary"
                onClick={() => setStep(3)}
                disabled={mandatory.length === 0}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ══ STEP 3 — Upload CV ══ */}
        {step === 3 && (
          <div className="card fade-up">
            <div className="section-header">
              <div className="section-icon">📄</div>
              <div>
                <h2>Candidate CV</h2>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>
                  Upload a PDF (ATS-friendly format recommended) or paste the text directly.
                </p>
              </div>
            </div>

            {/* Drop zone — supports click and drag & drop */}
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file && file.type === 'application/pdf') {
                  handleFileUpload({ target: { files: [file] } });
                } else if (file) {
                  alert('Please drop a PDF file.');
                }
              }}
              style={{
                border: isDragging
                  ? '2px dashed var(--primary)'
                  : cvFileName ? '2px dashed var(--pass)' : '2px dashed var(--border)',
                borderRadius: 'var(--radius)',
                padding: '32px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                marginBottom: 20,
                background: isDragging
                  ? 'var(--primary-light)'
                  : cvFileName ? 'var(--pass-bg)' : 'var(--bg-subtle)',
                transition: 'all 0.15s',
              }}
            >
              {cvLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div className="spinner" />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Extracting text from PDF…</span>
                </div>
              ) : isDragging ? (
                <div>
                  <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>📂</div>
                  <strong style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>Drop PDF here</strong>
                </div>
              ) : cvFileName ? (
                <div>
                  <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>✅</div>
                  <strong style={{ fontSize: '0.9rem', color: 'var(--pass)' }}>{cvFileName}</strong>
                  <p style={{ fontSize: '0.8rem', marginTop: 4 }}>Text extracted. Review and edit below if needed.</p>
                  <p style={{ fontSize: '0.75rem', marginTop: 4, color: 'var(--text-faint)' }}>Click or drop a new file to replace</p>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>📎</div>
                  <strong style={{ fontSize: '0.9rem' }}>Drag & drop PDF here</strong>
                  <p style={{ fontSize: '0.8rem', marginTop: 4, color: 'var(--text-muted)' }}>or click to browse · ATS-friendly CVs work best</p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
            </div>

            {/* CV text label + live char counter */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ margin: 0 }}>CV Text — review &amp; edit before analyzing</label>
              <span style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                color: cvText.length > CV_CHAR_LIMIT ? 'var(--fail)' : cvText.length > CV_CHAR_LIMIT * 0.85 ? 'var(--warn)' : 'var(--text-faint)',
              }}>
                {cvText.length.toLocaleString()} / {CV_CHAR_LIMIT.toLocaleString()} chars
              </span>
            </div>

            {/* Textarea — full content always shown */}
            <textarea
              placeholder="Or paste CV text directly here…"
              value={cvText}
              onChange={(e) => setCvText(e.target.value)}
              style={{
                minHeight: 220,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.82rem',
                borderColor: cvText.length > CV_CHAR_LIMIT ? 'var(--fail)' : undefined,
              }}
            />

            {/* Visual limit marker — only shown when over limit */}
            {cvText.length > CV_CHAR_LIMIT && (
              <div style={{
                marginTop: 8,
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--fail-bg)',
                border: '1px solid var(--fail)',
                fontSize: '0.82rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: 'var(--fail)', fontWeight: 700 }}>⚠️ CV exceeds {CV_CHAR_LIMIT.toLocaleString()} character limit</span>
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                  Content after character <strong style={{ fontFamily: 'var(--font-mono)' }}>{CV_CHAR_LIMIT.toLocaleString()}</strong> will not be analyzed.
                  Please trim sections that are less relevant — e.g. early education, unrelated work experience, or duplicate information.
                  The content you keep should prioritize skills, recent experience, and achievements most relevant to this role.
                </p>
                <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--text-faint)' }}>Content within limit ends at: </span>
                  <span style={{ color: 'var(--text)' }}>"…{cvText.slice(CV_CHAR_LIMIT - 60, CV_CHAR_LIMIT).trim()}"</span>
                  <span style={{ color: 'var(--fail)', fontWeight: 700 }}> ← limit</span>
                </div>
              </div>
            )}

            {analyzeError && (
              <div className="warning-banner" style={{ marginTop: 12 }}>
                ⚠️ {analyzeError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setStep(2)}>← Back</button>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                {cvText.length > CV_CHAR_LIMIT && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--fail)' }}>
                    Trim {(cvText.length - CV_CHAR_LIMIT).toLocaleString()} characters to enable analysis
                  </span>
                )}
                <button
                  className="btn btn-primary"
                  onClick={handleAnalyze}
                  disabled={analyzing || !cvText.trim() || cvText.length > CV_CHAR_LIMIT}
                >
                  {analyzing ? <><div className="spinner" /> Analyzing…</> : '🔍 Analyze CV'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ STEP 4 — Results ══ */}
        {step === 4 && result && (
          <div className="fade-up">
            {/* Header bar */}
            <div
              className="card"
              style={{
                marginBottom: 20,
                background: 'var(--primary)',
                border: 'none',
                color: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Candidate
                  </div>
                  <h2 style={{ color: '#fff', fontSize: '1.4rem', margin: 0 }}>
                    {result.candidate_name || 'Unknown Candidate'}
                  </h2>
                  {result.cv_quality === 'INSUFFICIENT' && (
                    <span
                      style={{
                        display: 'inline-block', marginTop: 6,
                        background: 'rgba(255,255,255,0.15)',
                        padding: '3px 10px', borderRadius: 99,
                        fontSize: '0.75rem',
                      }}
                    >
                      ⚠️ CV data insufficient — results may be limited
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 24 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>
                      {result.mandatory_summary?.passed}/{result.mandatory_summary?.total}
                    </div>
                    <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>MANDATORY</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>
                      {result.nicetohave_total}
                      <span style={{ fontSize: '1rem', opacity: 0.7 }}>/100</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>NICE-TO-HAVE</div>
                  </div>
                </div>
              </div>
            </div>

            {/* CV trimmed warning */}
            {(result._truncated || result._cv_trimmed) && (
              <div className="warning-banner" style={{ marginBottom: 20 }}>
                ⚠️ CV text was trimmed to fit the analysis limit. For best results, paste only the relevant sections (Summary, Skills, Experience, Education) and remove any unrelated content.
              </div>
            )}

            {/* Recruiter Summary */}
            <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--primary)' }}>
              <div className="section-header">
                <div className="section-icon">💡</div>
                <h2>Recruiter Summary</h2>
              </div>
              <div style={{ fontSize: '0.95rem', color: 'var(--text)' }}>
                {renderMarkdown(result.recruiter_summary)}
              </div>
            </div>

            {/* Mandatory */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-header">
                <div className="section-icon">🔒</div>
                <h2>
                  Mandatory Requirements —{' '}
                  <span
                    style={{
                      color:
                        result.mandatory_summary?.passed === result.mandatory_summary?.total
                          ? 'var(--pass)'
                          : 'var(--fail)',
                    }}
                  >
                    {result.mandatory_summary?.passed}/{result.mandatory_summary?.total} passed
                  </span>
                </h2>
              </div>
              {result.mandatory?.map((m, i) => <MandatoryCard key={i} item={m} />)}
            </div>

            {/* Nice-to-Have */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-header">
                <div className="section-icon">⭐</div>
                <h2>Nice-to-Have Score — {result.nicetohave_total}/100</h2>
              </div>
              <div className="progress-bar" style={{ height: 10, marginBottom: 20 }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${result.nicetohave_total}%`,
                    background: result.nicetohave_total >= 70
                      ? 'var(--pass)'
                      : result.nicetohave_total >= 40
                      ? 'var(--warn)'
                      : 'var(--fail)',
                  }}
                />
              </div>
              {result.nicetohave?.map((n, i) => <NiceToHaveCard key={i} item={n} />)}
            </div>

            {/* Qualitative Signals */}
            {result.qualitative_signals?.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="section-header">
                  <div className="section-icon">🔍</div>
                  <div>
                    <h2>Qualitative Signals</h2>
                    <p style={{ margin: 0, fontSize: '0.82rem' }}>
                      Inferred from how the candidate describes their experience — beyond keyword matching.
                    </p>
                  </div>
                </div>
                {result.qualitative_signals.map((q, i) => <QualitativeCard key={i} item={q} />)}
              </div>
            )}

            {/* Gap Analysis */}
            {result.gap_analysis?.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="section-header">
                  <div className="section-icon">⚡</div>
                  <h2>Gap Analysis</h2>
                </div>
                {result.gap_analysis.map((g, i) => <GapCard key={i} item={g} />)}
              </div>
            )}

            {/* Interview Questions */}
            {result.interview_questions?.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="section-header">
                  <div className="section-icon">🎤</div>
                  <div>
                    <h2>Suggested Interview Questions</h2>
                    <p style={{ margin: 0, fontSize: '0.82rem' }}>Based on gaps and areas needing verification.</p>
                  </div>
                </div>
                {result.interview_questions.map((q, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex', gap: 12, alignItems: 'flex-start',
                      padding: '12px 16px',
                      background: 'var(--bg-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: 'var(--primary-light)', color: 'var(--primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </span>
                    <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text)' }}>{q}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Token usage — Feature 3 */}
            {result._usage && (
              <div style={{
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border)',
                marginBottom: 20,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>⚡</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {result._usage.input_tokens.toLocaleString()} in · {result._usage.output_tokens.toLocaleString()} out · {result._usage.total_tokens.toLocaleString()} total tokens
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Actual cost · Haiku
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                      ${result._usage.cost_usd.toFixed(4)}
                      <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
                        (~Rp {Math.round(result._usage.cost_usd * 16500).toLocaleString()})
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Est. cost · Sonnet
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                      ${((result._usage.input_tokens / 1_000_000 * 3) + (result._usage.output_tokens / 1_000_000 * 15)).toFixed(4)}
                      <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-faint)', marginLeft: 4 }}>
                        (~Rp {Math.round(((result._usage.input_tokens / 1_000_000 * 3) + (result._usage.output_tokens / 1_000_000 * 15)) * 16500).toLocaleString()})
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn btn-secondary" onClick={() => { setStep(3); setResult(null); }}>
                ← Screen Another CV
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setStep(1);
                  setResult(null);
                  setJdText('');
                  setParsedJD(null);
                  setMandatory([]);
                  setNiceToHave([]);
                  setAdditionalContext('');
                  setCvText('');
                  setCvFileName('');
                }}
              >
                🔄 Start Over
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '16px 0',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-faint)',
        }}
      >
        CV Screening Assistant · Internal prototype · Astro Technologies Indonesia · AI outputs are recommendations, not decisions.
      </footer>
    </>
  );
}
