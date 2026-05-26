// /pages/api/parse-jd.js
// ─────────────────────────────────────────────────────────────
// Accepts raw JD text (copy-pasted from any job board).
// Claude extracts structured hiring criteria from it.
// URL fetching removed — job boards like Kalibrr block
// server-side requests. Text paste is more reliable.
// ─────────────────────────────────────────────────────────────

const PARSE_SYSTEM_PROMPT = `You are a hiring criteria extractor. Given a job description text, extract:
1. All mandatory/minimum requirements (hard requirements without which a candidate cannot be considered)
2. All nice-to-have requirements (preferred but not blocking)

EDUCATION RULES:
- Always check ALL sections of the text for education requirements, including
  "Minimum Qualifications", "Jobs Summary", "Educational Requirement", and any metadata sections
- Education requirements are ALWAYS mandatory unless explicitly stated as "preferred"
- Never skip or omit education requirements even if they appear in a summary/metadata section

CATEGORIZATION:
- type "technical": tools, frameworks, languages, methodologies
- type "education": degree, certification, academic background  
- type "experience": years of experience, domain experience, industry background

WEIGHT RULES:
- Assign weights to nice-to-have items based on how much they are emphasized in the JD
- All weights must sum to exactly 100
- If only one nice-to-have exists, assign it 100

HONESTY RULES:
- Only extract what is explicitly stated in the job description
- Do not invent or infer requirements not present in the text
- If no nice-to-have requirements are mentioned, return an empty array

Return ONLY valid JSON, no explanation, no markdown fences.`;

function buildParsePrompt(jdText) {
  return `Extract hiring criteria from this job description text.
The text may contain extra metadata from a job board (office address, industry tags, links) — ignore those, focus only on actual job requirements.

JOB DESCRIPTION TEXT:
${jdText}

Return this exact JSON structure:
{
  "job_title": "",
  "company": "",
  "job_description_clean": "",
  "mandatory": [
    { "skill": "", "type": "technical/education/experience" }
  ],
  "nicetohave": [
    { "skill": "", "type": "technical/education/experience", "weight": 0 }
  ]
}

Weights for nice-to-have items must sum to exactly 100.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Job description text is required." });
  }

  // Cap input to avoid excessive token usage
  const trimmedText = text.trim().slice(0, 8000);

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
        max_tokens: 1000,
        system: PARSE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildParsePrompt(trimmedText) }],
      }),
    });

    if (!response.ok) {
      return res.status(502).json({ error: "AI service error. Please try again." });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || "";
    const clean = rawText.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);
  } catch (err) {
    console.error("parse-jd error:", err);
    return res.status(500).json({ error: "Failed to extract criteria. Please try again." });
  }
}
