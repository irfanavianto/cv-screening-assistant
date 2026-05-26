// /pages/api/parse-jd.js
// ─────────────────────────────────────────────────────────────
// Fetches a job posting URL and uses Claude to extract
// structured hiring criteria (mandatory + nice-to-have).
// Runs server-side so there are no CORS issues fetching
// third-party job sites like Kalibrr.
// ─────────────────────────────────────────────────────────────

const PARSE_SYSTEM_PROMPT = `You are a hiring criteria extractor. Given a job description text, extract:
1. All mandatory/minimum requirements (hard requirements without which a candidate cannot be considered)
2. All nice-to-have requirements (preferred but not blocking)

For each nice-to-have skill, suggest a default weight (must sum to 100 across all nice-to-have items).
Categorize each requirement as: technical, education, or experience.

HONESTY RULES:
- Only extract what is explicitly stated in the job description
- Do not invent requirements
- If no nice-to-have requirements are mentioned, return an empty array

Return ONLY valid JSON, no explanation, no markdown fences.`;

function buildParsePrompt(jdText) {
  return `Extract hiring criteria from this job description:

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

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required." });

  try {
    // Step 1: Fetch the job posting page
    const pageRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CVScreener/1.0)" },
    });

    if (!pageRes.ok) {
      return res.status(422).json({ error: "Could not fetch the job posting URL. Please paste the job description manually." });
    }

    // Step 2: Strip HTML tags to get plain text
    const html = await pageRes.text();
    const plainText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000); // cap to avoid huge token usage

    // Step 3: Ask Claude to extract structured criteria
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
        messages: [{ role: "user", content: buildParsePrompt(plainText) }],
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
    return res.status(500).json({ error: "Failed to parse job description. Please paste it manually." });
  }
}
