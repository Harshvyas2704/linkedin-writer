export const DEFAULT_MODEL = "gemini-3.8-flash";

const API = "https://generativelanguage.googleapis.com/v1beta";
// 503 (overloaded), 500 and 429 (rate limit) are usually temporary.
const RETRYABLE = [429, 500, 503];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Remembers a model that worked after the chosen one was overloaded, for this panel session.
let workingFallback = null;
let modelListCache = null;

async function post(model, apiKey, body) {
  return fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
}

// Try one model a few times with backoff. Returns the last Response.
async function tryModel(model, apiKey, body, delays) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await post(model, apiKey, body);
    if (res.ok || !RETRYABLE.includes(res.status) || attempt >= delays.length) return res;
    await sleep(delays[attempt]);
  }
}

// Ask the API which text models this key can use, so fallbacks are never guessed names.
async function fallbackModels(apiKey, current) {
  if (!modelListCache) {
    try {
      const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey } });
      const data = res.ok ? await res.json() : {};
      modelListCache = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""))
        .filter((n) => /^gemini-/.test(n) && !/(image|tts|audio|live|embed|vision|thinking-exp|robotics|computer-use)/i.test(n));
    } catch {
      modelListCache = [];
    }
  }
  const version = (n) => parseFloat(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || "0");
  const rank = (n) =>
    (/flash-lite/.test(n) ? 1 : /flash/.test(n) ? 0 : 2) * 100 + // flash, then flash-lite, then pro
    (/preview|exp/.test(n) ? 10 : 0) -                           // stable before preview
    version(n);                                                  // newer first
  return modelListCache.filter((n) => n !== current).sort((a, b) => rank(a) - rank(b));
}

export async function callGemini({ apiKey, model, system, user, json = false }) {
  const chosen = model || DEFAULT_MODEL;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
  };
  if (json) body.generationConfig = { responseMimeType: "application/json" };

  // 1. The model from Settings (or the fallback that last worked), with retries.
  const first = workingFallback || chosen;
  let res = await tryModel(first, apiKey, body, [1500, 4000]);
  let usedModel = first;

  // 2. Still overloaded: try up to 3 other models this key has access to.
  if (!res.ok && RETRYABLE.includes(res.status)) {
    const tried = [first];
    for (const alt of (await fallbackModels(apiKey, first)).slice(0, 3)) {
      tried.push(alt);
      const r = await tryModel(alt, apiKey, body, [1500]);
      if (r.ok) {
        res = r;
        usedModel = alt;
        workingFallback = alt === chosen ? null : alt;
        console.info(`[gemini] ${first} was busy, used ${alt} instead`);
        break;
      }
      if (!RETRYABLE.includes(r.status)) break;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        `${err.error?.message || `Gemini is busy (HTTP ${res.status})`} Tried: ${tried.join(", ")}. Wait a minute and try again.`
      );
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini request failed (HTTP ${res.status}, model ${usedModel})`);
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();

  if (!text) {
    const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason;
    throw new Error(`Empty response from Gemini${reason ? ` (${reason})` : ""}`);
  }
  return text;
}

export function parseJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not read Gemini's response. Try again.");
  }
}
