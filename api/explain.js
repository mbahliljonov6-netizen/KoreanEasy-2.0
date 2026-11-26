// Vercel serverless endpoint. Keep GEMINI_API_KEY in Vercel Environment Variables.
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Add it in Vercel Environment Variables." });
  const body = req.body || {};
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const lang = typeof body.lang === "string" ? body.lang : "English";
  const mode = body.mode || "explain";
  if (!text) return res.status(400).json({ error: "Please enter Korean text first." });
  if (text.length > 5000) return res.status(400).json({ error: "Text is too long. Maximum is 5,000 characters." });
  const allowed = ["English","Uzbek","Vietnamese","Chinese","Mongolian","Nepali","Thai","Russian","Japanese","Indonesian","Khmer","Filipino"];
  const outputLanguage = allowed.includes(lang) ? lang : "English";
  const isKorean = /[\uac00-\ud7af]/.test(text);
  if (!isKorean) return res.status(400).json({ error: "Please provide Korean text. KoreanEasy currently analyzes Korean-language notices and messages." });

  let prompt;
  if (mode === "chat") {
    prompt = `You are KoreanEasy, a careful assistant for international students living in South Korea. Answer the user's question in ${outputLanguage}. Be practical, friendly and concise. If the question depends on current university or government policy, say what needs verification rather than inventing facts. The user's Korean text or voice transcript is: """${text}""". Return ONLY JSON: {"answer":"answer in ${outputLanguage}","suggested_actions":["action 1","action 2"]}`;
  } else {
    prompt = `You are KoreanEasy, an accurate Korean notice explainer for international students in South Korea.
Analyze the Korean source text. Do not invent details. If a date, time, location, deadline or task is not explicitly stated, use an empty string for that field. Preserve dates and numbers exactly as written; do not calculate or guess.
Return ONLY valid JSON with this exact structure:
{
 "summary":"2-4 clear beginner-friendly sentences in ${outputLanguage}",
 "actions":{"deadline":"exact deadline or empty string","date_time":"date and time or empty string","location":"place or empty string","task":"what the student must do or empty string","submission":"submission method/file format or empty string"},
 "words":[{"ko":"Korean word or phrase","meaning":"meaning in ${outputLanguage}","note":"short context hint"}],
 "quiz":[{"question":"question in ${outputLanguage}","options":["option A","option B","option C","option D"],"answer":"exactly one option copied from options","explanation":"short explanation in ${outputLanguage}"}]
}
Rules: exactly 5 vocabulary items and exactly 3 quiz questions. Quiz options must be distinct and only one correct answer. Questions and explanations must be in ${outputLanguage}. Keep Korean terms in Korean. If the source is not a Korean notice/message or does not contain enough information for a field, do not fabricate content. Source text:
"""${text}"""`;
  }
  const model = process.env.GEMINI_MODEL || "gemini-3.7-flash";
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message;
      return res.status(502).json({ error: detail ? `Gemini error: ${detail}` : `AI service error (${response.status}). Check your model and API key.` });
    }
    const output = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    const match = output.match(/\{[\s\S]*\}/);
    if (!match) return res.status(502).json({ error: "Gemini returned an unexpected response. Please try again." });
    const parsed = JSON.parse(match[0]);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (mode === "chat") {
      if (!parsed.answer) return res.status(502).json({ error: "AI answer was incomplete." });
      return res.status(200).json(parsed);
    }
    if (!parsed.summary || !Array.isArray(parsed.words) || !Array.isArray(parsed.quiz) || !parsed.actions) {
      return res.status(502).json({ error: "AI response was incomplete. Please try again." });
    }
    parsed.words = parsed.words.slice(0, 5);
    parsed.quiz = parsed.quiz.slice(0, 3).map(q => ({
      ...q,
      options: Array.isArray(q.options) ? q.options.slice(0, 4) : [q.answer, "I am not sure", "Not mentioned"],
    }));
    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: "Server error while contacting Gemini. Please try again." });
  }
};
