# CV Screening Assistant
> AI-powered recruitment copilot · Astro Technologies Indonesia

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

1. Push this folder to a GitHub repository
2. Go to vercel.com → New Project → Import your repo
3. Add environment variable: `ANTHROPIC_API_KEY` = your key
4. Deploy → get a shareable URL

---

## Project Structure

```
astro-cv-screener/
│
├── pages/
│   ├── index.js          ← Main UI (all 4 steps)
│   ├── _app.js           ← Theme provider (light/dark)
│   └── api/
│       ├── analyze.js    ← Core: sends CV + criteria to Claude
│       └── parse-jd.js   ← Fetches job URL, extracts criteria
│
├── styles/
│   └── globals.css       ← All styling (light + dark theme)
│
├── .env.example          ← Template for API key
├── .env.local            ← YOUR API key (never commit this!)
├── next.config.js        ← Next.js config
└── package.json
```

---

## Architecture Flow

```
USER BROWSER
│
│  Step 1 — Job Description
│  ├── Option A: Paste URL
│  │   └── POST /api/parse-jd
│  │       ├── Server fetches URL (no CORS issues)
│  │       ├── Strips HTML → plain text
│  │       └── Claude extracts: mandatory, nice-to-have, weights
│  │
│  └── Option B: Paste JD text manually
│
│  Step 2 — Hiring Criteria Review
│  ├── Edit mandatory list (add/remove)
│  ├── Edit nice-to-have + adjust weights
│  └── Add optional "additional context" free text
│
│  Step 3 — CV Upload
│  ├── Upload PDF
│  │   └── pdf.js runs IN BROWSER (no server needed)
│  │       → Extracted text appears in editable textarea
│  └── User reviews / edits extracted text
│      └── Fallback: paste CV text manually
│
│  Step 4 — Analyze
│  └── POST /api/analyze
│      ├── Rate limit check (5 req/min per IP)
│      ├── Builds prompt: JD + criteria + CV text
│      ├── Claude (Haiku) analyzes with 3-layer framework:
│      │   ├── Layer 1: Evidence Extraction
│      │   ├── Layer 2: Signal Interpretation
│      │   │   (Ownership / Complexity / Growth / Context Fit)
│      │   └── Layer 3: Gap Analysis
│      └── Returns structured JSON → rendered as Results UI
│
VERCEL SERVERS (serverless functions)
└── API key stored here only — never exposed to browser
```

---

## Claude Analysis Framework

The system prompt instructs Claude to analyze CVs across 3 layers:

### Layer 1 — Evidence Extraction
What is explicitly stated in the CV: skills, years of experience, domain, education.

### Layer 2 — Signal Interpretation
What can be inferred from *how* the candidate describes their experience:
- **Ownership signal** — executor vs. owner vs. leader
- **Complexity signal** — scale and difficulty of problems handled
- **Growth signal** — progression pattern across roles
- **Context fit** — alignment with fast-paced, data-driven scale-up environment

### Layer 3 — Gap Analysis
For each missing requirement: is this a BLOCKER, RAMP-UP item, or MINOR gap?

---

## Scoring Model

| Layer | Type | How it works |
|-------|------|-------------|
| Mandatory | Pass / Fail | Hard filter — no partial credit |
| Nice-to-have | Weighted score (0–100) | Recruiter sets weights, Claude scores |
| Qualitative | STRONG / MODERATE / WEAK | Per dimension, with cited evidence |
| Confidence | HIGH / MEDIUM / LOW | Per skill — how strong is the evidence? |

---

## Token Optimization

- Model: `claude-haiku-4-5` (cheapest, sufficient for structured extraction)
- System prompt is short and instruction-focused
- CV text is pre-cleaned before sending (whitespace stripped)
- JD text capped at 6,000 characters in parse-jd route
- max_tokens: 2,000 for analysis, 1,000 for JD parsing
- Rate limit: 5 requests/minute per IP

---

## Honesty & Bias Design

- Skills with no CV evidence → `confidence: LOW`, `evidence: "Not found in CV"`
- CVs under 100 words → `cv_quality: INSUFFICIENT` warning shown in UI
- Education requirements treated same as technical skills (no special weighting)
- University name is NOT part of the default scoring — only if recruiter explicitly adds it
- Every score has a cited evidence field — no black-box outputs
- Footer reminder: "AI outputs are recommendations, not decisions"
