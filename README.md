# CV Screening Assistant
> AI-powered recruitment copilot · by M Irfan Avianto · Astro Personal AI Challenge 2026

A prototype tool that helps HR and hiring managers screen candidates faster, more consistently, and with greater transparency — built with Next.js and Claude API (Haiku).

**Live demo:** https://cv-screening-assistant.vercel.app

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file and fill in your API key
cp .env.example .env.local
# Edit .env.local → paste your Anthropic API key

# 3. Run locally
npm run dev
# Open http://localhost:3000
```

---

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to vercel.com → New Project → Import your repo
3. Add environment variable: `ANTHROPIC_API_KEY` = your Anthropic API key
4. Deploy → get a shareable URL

---

## Project Structure

```
astro-cv-screener/
│
├── pages/
│   ├── index.js           ← Main UI (all 4 steps + PDF export)
│   ├── _app.js            ← Theme provider (light/dark)
│   └── api/
│       ├── analyze.js     ← Core analysis engine (Claude Haiku)
│       ├── parse-jd.js    ← JD text → structured hiring criteria
│       └── reformat-cv.js ← Raw PDF text → clean markdown
│
├── styles/
│   └── globals.css        ← All styling (light + dark theme)
│
├── .env.example           ← Template for API key
├── .env.local             ← YOUR API key (never commit this!)
├── next.config.js         ← Next.js config
└── package.json
```

---

## User Flow

```
Step 1 — Job Description
  └── Paste JD text from any job board (Kalibrr, LinkedIn, etc.)
  └── Claude auto-extracts mandatory + nice-to-have criteria + weights
  └── HR reviews and edits before proceeding

Step 2 — Hiring Criteria
  └── Confirm mandatory requirements (hard filters)
  └── Set nice-to-have weights (HR controls the scoring)
  └── Add optional Additional Context (qualitative nuances)

Step 3 — Upload CV
  └── Upload PDF → pdf.js extracts text in browser
  └── Claude reformats raw text to clean markdown
  └── HR reviews, edits, and curates before analysis
      (char limit: 6,000 — HR decides what's most relevant)

Step 4 — Results
  └── POST /api/analyze → Claude Haiku (temperature: 0)
  └── Returns structured JSON with:
      - Mandatory pass/fail per requirement
      - Nice-to-have score breakdown
      - 5 standard qualitative signal dimensions
      - Additional signals (from HR's context)
      - Gap analysis (BLOCKER / RAMP-UP / MINOR)
      - Suggested interview questions
      - Standout observation
      - Recruiter summary (markdown, justified)
  └── Screening Status computed client-side (not by AI)
  └── Export to PDF (jsPDF) or Excel (SheetJS)
```

---

## Architecture

```
BROWSER (client-side)              VERCEL SERVERS
─────────────────────              ──────────────────────────────
pdf.js → text extraction           /api/parse-jd
                                     └── Claude Haiku
                                         extract criteria from JD

renderMarkdown()                   /api/reformat-cv
getScreeningStatus()                 └── Claude Haiku
getMandatoryCounts()                     reformat raw CV → markdown
generatePDF() via jsPDF
exportToExcel() via SheetJS        /api/analyze
localStorage (records)               └── Claude Haiku (temp=0)
                                         3-layer analysis framework
                                         returns structured JSON

                                   ANTHROPIC_API_KEY
                                   stored server-side only
```

---

## Analysis Framework (System Prompt)

Claude is instructed to analyze CVs in 3 layers:

**Layer 1 — Evidence Extraction**
Explicit skills, years of experience, domain, education.

**Layer 2 — Signal Interpretation (5 fixed dimensions)**
Always evaluated for every candidate:
1. Ownership Level — executor / contributor / owner / leader
2. Complexity & Scale — scale and difficulty of problems handled
3. Growth Pattern — progression across roles
4. Cross-functional Awareness — awareness of downstream impact
5. Execution Velocity — evidence of fast-paced delivery

Plus **Additional Signals** — evaluated only when HR provides Additional Context.

**Layer 3 — Gap Analysis**
Only for unmet mandatory and nice-to-have requirements.
Severity: BLOCKER / RAMP-UP / MINOR.
Additional context is NOT included in gap analysis — it has its own section.

---

## Scoring Model

| Component | How it works |
|-----------|-------------|
| Mandatory | Pass/fail per requirement — counted from array, not Claude's summary |
| Nice-to-Have | Weighted 0–100, HR sets weights |
| Screening Status | Computed client-side from formula (not AI opinion) |
| Qualitative | STRONG / MODERATE / WEAK per dimension, evidence cited |
| Confidence | HIGH / MEDIUM / LOW per skill |

**Adaptive composite score:**
```
If NtH configured:
  Score = (passed/total × 60) + (NtH score × 40/100) − (BLOCKER × 50)

If NtH not configured:
  Score = (passed/total × 100) − (BLOCKER × 50)

Shortlist    ≥ 70
Consider     ≥ 45
Review Gap   ≥ 20
Not Qualified < 20
```

RAMP-UP and MINOR gaps do NOT penalize score — they are informational only.

---

## Token Management

- Model: `claude-haiku-4-5-20251001` (cost-efficient)
- Temperature: `0` on all routes (deterministic, consistent output)
- CV text cleaned before sending: collapse whitespace, hard cap 6,000 chars
- max_tokens: 8,000 for analysis, 1,000 for JD parsing, 4,000 for reformat
- Rate limit: 5 requests/minute per IP (in-memory, resets on cold start)
- Actual cost per full screening: ~$0.013–0.017 (Haiku)

---

## Design Principles

- **AI as copilot, not decision maker** — every output has evidence, HR makes the call
- **Explainability first** — no black-box scores, every rating is cited from CV text
- **Human-in-the-loop** — HR curates CV input, reviews criteria, can override any output
- **Honest about uncertainty** — LOW confidence when evidence is weak or absent
- **Scoring computed client-side** — mandatory counts recalculated from array, not trusted from Claude

---

## Honesty & Bias Guardrails

- Skills absent from CV → `confidence: LOW`, evidence: "Not found in CV"
- CV under 100 words → `cv_quality: INSUFFICIENT` warning shown
- Education treated same as technical skills — no automatic bonus
- University name excluded from default scoring
- Additional Context excluded from Gap Analysis (separate section)
- Footer on all outputs: "AI outputs are recommendations, not decisions"

---

## Export

**PDF (jsPDF)** — proper A4 document, searchable text, suitable for sharing with hiring managers:
- Candidate name in UPPERCASE
- Screening Status at top (executive summary principle)
- All analysis sections included
- Token usage + cost transparency
- Header: "CV Screening Assistant by M Irfan Avianto · Astro Personal AI Challenge"
- Footer: "CONFIDENTIAL · For internal use only"

**Excel (SheetJS)** — cumulative records stored in localStorage:
- One row per candidate screened
- Columns: Date, Candidate, Role, Mandatory Passed, Mandatory Total, NtH Score, Top Gap, Screening Status, HR Notes
- "Reset & Save Current" option to clear history while keeping latest result
