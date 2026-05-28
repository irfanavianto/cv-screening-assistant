// /pages/api/reformat-cv.js
// ─────────────────────────────────────────────────────────────
// Takes raw CV text (from PDF extraction) and asks Claude
// to reformat it into clean, structured markdown.
// This runs before analysis — purely a presentation/readability step.
// ─────────────────────────────────────────────────────────────

const REFORMAT_SYSTEM_PROMPT = `You are a CV formatting assistant. Your only job is to reformat raw CV text into clean, structured markdown.

RULES:
- Use ## for major section headers (EXPERIENCE, EDUCATION, SKILLS, PROJECTS, etc.)
- Use **bold** for candidate name, job titles, and company names
- Use *italic* for dates and locations
- Use - for bullet points under each role
- Preserve ALL original content — do not add, remove, or paraphrase anything
- Fix spacing and line break issues from PDF extraction artifacts
- Do not add any commentary, introduction, or conclusion
- Output ONLY the reformatted markdown, nothing else`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'CV text is required.' });
  }

  // Cap input — reformat only needs the raw text, same limit as analysis
  const trimmed = text.trim().slice(0, 8000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        temperature: 0,
        system: REFORMAT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Reformat this CV text into clean markdown:\n\n${trimmed}` }],
      }),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    const data = await response.json();
    const formatted = data.content?.[0]?.text?.trim() || text;

    // Strip any accidental markdown fences Claude might add
    const clean = formatted.replace(/^```(?:markdown)?\n?/i, '').replace(/\n?```$/i, '').trim();

    return res.status(200).json({ formatted: clean });
  } catch (err) {
    console.error('reformat-cv error:', err);
    // On failure, return original text — don't block the user
    return res.status(200).json({ formatted: text, fallback: true });
  }
}
