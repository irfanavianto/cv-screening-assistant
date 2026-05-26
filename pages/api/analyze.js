// /pages/api/analyze.js
// ─────────────────────────────────────────────────────────────
// This is the ONLY place that talks to Claude API.
// The API key never leaves this file — it runs on Vercel servers,
// not in the user's browser.
// ─────────────────────────────────────────────────────────────

// ── Rate limiting (simple in-memory, resets on cold start) ───
const requestLog = new Map(); // ip → [timestamps]
const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS = 5;       // max 5 analyses per minute per IP

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter(
    (t) => now - t < WINDOW_MS
  );
  if (timestamps.length >= MAX_REQUESTS) return true;
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return false;
}

// ── System prompt (the "brain" of the tool) ──────────────────
const SYSTEM_PROMPT = `You are a recruitment copilot. Analyze a candidate's CV against provided hiring criteria. Be evidence-based, concise, and neutral.

ANALYSIS FRAMEWORK:
1. EXTRACT — Identify explicit skills, experience years, domain
2. INTERPRET — For each key experience, assess:
   - Ownership level (executor/contributor/owner/leader)
   - Complexity & scale of problems handled
   - Growth pattern across roles
   - Context fit for a fast-paced, data-driven scale-up
3. GAP ANALYSIS — For each missing requirement, assess severity: (blocker / ramp-up / minor)

SCORING RULES:
- Mandatory: pass/fail only, no partial credit
- Nice-to-have: apply recruiter-defined weights exactly as given
- Confidence: HIGH (explicit statement), MEDIUM (inferred from context), LOW (weak evidence or not found)

SKILL MATCHING RULES:
- Match skills by meaning, not exact keyword
- If match is semantic, set confidence MEDIUM and explain mapping in evidence field
- Never map skills that require significant assumption

HONESTY RULES:
- If evidence is absent or too vague, set confidence LOW and evidence to "Insufficient data" or "Not found in CV"
- Never infer or assume skills not supported by CV content
- If CV has fewer than 100 words, set cv_quality to "INSUFFICIENT"
- recruiter_summary must mention what could not be assessed due to limited CV data
- Education requirements follow the same matching and confidence rules as technical skills
- CV text may be formatted in markdown — interpret formatting (headers, bold, bullets) as structural hints, not literal content

RECRUITER SUMMARY WRITING STYLE:
- Write as a thoughtful senior recruiter speaking to a hiring manager — conversational, warm, direct
- Use markdown formatting: **bold** for key skills or critical gaps, *italic* for emphasis
- Structure with short paragraphs separated by blank lines (use \n\n between paragraphs):
  1. Opening: candidate's strongest selling point + overall fit signal
  2. Key gaps: what's missing and how critical it is
  3. Closing: one clear actionable recommendation
- Never use capslock labels (no "CANDIDATE OVERVIEW:", "BLOCKER ASSESSMENT:", etc.)
- 2-3 sentences per paragraph, not one long run-on block
- Tone: confident but balanced — highlight genuine strengths, flag real gaps without being harsh

OUTPUT LANGUAGE: Match the language of the job description provided.
Return ONLY valid JSON, no explanation, no markdown fences.`;

// ── User prompt builder ───────────────────────────────────────
function buildUserPrompt({ jobDescription, mandatory, niceToHave, additionalContext, cvText }) {
  return `JOB DESCRIPTION:
${jobDescription}

HIRING CRITERIA:
Mandatory: ${JSON.stringify(mandatory)}
Nice-to-have: ${JSON.stringify(niceToHave)}
Additional context: ${additionalContext || "None"}

CANDIDATE CV:
${cvText}

Return this exact JSON structure:
{
  "candidate_name": "",
  "cv_quality": "SUFFICIENT/INSUFFICIENT",
  "cv_quality_note": "",
  "mandatory": [
    {
      "skill": "",
      "type": "technical/education/experience",
      "pass": true,
      "evidence": "",
      "confidence": "HIGH/MEDIUM/LOW"
    }
  ],
  "mandatory_summary": {
    "passed": 0,
    "total": 0
  },
  "nicetohave": [
    {
      "skill": "",
      "type": "technical/education/experience",
      "weight": 0,
      "score": 0,
      "evidence": "",
      "confidence": "HIGH/MEDIUM/LOW"
    }
  ],
  "nicetohave_total": 0,
  "qualitative_signals": [
    {
      "dimension": "",
      "rating": "STRONG/MODERATE/WEAK",
      "evidence": ""
    }
  ],
  "gap_analysis": [
    {
      "skill": "",
      "severity": "BLOCKER/RAMP-UP/MINOR",
      "note": ""
    }
  ],
  "interview_questions": ["", "", ""],
  "recruiter_summary": ""
}`;
}

// ── Main handler ──────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Rate limit check
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment before trying again." });
  }

  const { jobDescription, mandatory, niceToHave, additionalContext, cvText } = req.body;

  // Basic input validation
  if (!jobDescription || !mandatory || !niceToHave || !cvText) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  // Clean CV text to reduce token usage while preserving structure
  // 1. Collapse 3+ consecutive newlines → 2 (preserve section breaks)
  // 2. Collapse multiple spaces/tabs → single space
  // 3. Trim each line and remove empty lines
  // 4. Hard cap at 4000 chars — enough for a 2-page CV, prevents truncation
  const CV_CHAR_LIMIT = 6000;
  const cleanedCvText = cvText
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    .slice(0, CV_CHAR_LIMIT);

  const cvWasTrimmed = cvText.length > CV_CHAR_LIMIT;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserPrompt({ jobDescription, mandatory, niceToHave, additionalContext, cvText: cleanedCvText }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Anthropic API error:", err);
      return res.status(502).json({ error: "AI service error. Please try again." });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || "";

    // Strip markdown fences just in case
    let clean = rawText.replace(/```json|```/g, "").trim();

    // If JSON is truncated (unterminated string), attempt recovery
    // by finding the last valid closing brace
    let result;
    try {
      result = JSON.parse(clean);
    } catch (parseErr) {
      // Try to recover truncated JSON by finding last complete top-level field
      const lastBrace = clean.lastIndexOf('}');
      if (lastBrace > 0) {
        // Close any open arrays and the root object
        let truncated = clean.slice(0, lastBrace + 1);
        // Count unclosed brackets
        const opens = (truncated.match(/\[/g) || []).length;
        const closes = (truncated.match(/\]/g) || []).length;
        const unclosed = opens - closes;
        if (unclosed > 0) truncated += ']'.repeat(unclosed);
        // Ensure root object is closed
        if (!truncated.trimEnd().endsWith('}')) truncated += '}';
        try {
          result = JSON.parse(truncated);
          result._truncated = true; // flag so UI can show a warning
        } catch {
          throw new Error("AI response was too long and could not be parsed. Please try with a shorter CV.");
        }
      } else {
        throw parseErr;
      }
    }

    if (cvWasTrimmed) result._cv_trimmed = true;

    // Feature 3: attach token usage + cost estimate to result
    const usage = data.usage || {};
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    // Haiku pricing: $0.80/1M input, $4.00/1M output
    const inputCost  = (inputTokens  / 1_000_000) * 0.80;
    const outputCost = (outputTokens / 1_000_000) * 4.00;
    result._usage = {
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      total_tokens:  inputTokens + outputTokens,
      cost_usd:      parseFloat((inputCost + outputCost).toFixed(6)),
      model:         "claude-haiku-4-5",
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
