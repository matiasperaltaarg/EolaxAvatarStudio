// Server-only OpenRouter client (LLM script assist + translation).
// OPENROUTER_API_KEY must never reach the browser.

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Cheap/fast model for script assist (overridable via env).
const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.5-haiku";

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "Missing OPENROUTER_API_KEY. Set it server-side (Vercel → Project " +
        "Settings → Environment Variables)."
    );
  }
  return key;
}

async function chat(system: string, user: string): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      // Optional attribution headers recommended by OpenRouter.
      "X-Title": "Eolax Avatar Studio",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter request failed (${res.status}): ${detail || res.statusText}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }
  return content;
}

// Improve a script for social media, matching the avatar's personality/tone.
export async function improveScript(
  script: string,
  personality: string | null
): Promise<string> {
  const personalityNote = personality
    ? `The avatar's personality/tone to match: "${personality}".`
    : "No specific personality is set; use a warm, engaging brand voice.";

  const system = [
    "You are a social-media scriptwriter for short talking-head videos.",
    "Rewrite the user's script to be concise, engaging and natural when spoken aloud,",
    "with a clear hook at the start and a clear call-to-action at the end.",
    "Keep it roughly the same length (short — suitable for a 15-40s clip).",
    personalityNote,
    "Return ONLY the improved script text, with no preamble, quotes or commentary.",
  ].join(" ");

  return chat(system, script);
}

// Translate a script into the target language, preserving tone and length.
export async function translateScript(
  text: string,
  languageEnglishName: string
): Promise<string> {
  const system = [
    `Translate the user's script into ${languageEnglishName}, keeping the same tone,`,
    "register and approximate length, and keeping it natural when spoken aloud.",
    `If the text is already in ${languageEnglishName}, return it unchanged.`,
    "Return ONLY the translated text, with no preamble, quotes or commentary.",
  ].join(" ");

  return chat(system, text);
}

// Turn a user's free-text look description (often Spanish, colloquial) into a
// precise English image-EDIT instruction for flux-kontext-pro. kontext follows
// English far better and rewards explicit, itemized wardrobe/scene language.
// The identity-preservation clause is added by the route, not here.
export async function enrichLookPrompt(freeText: string): Promise<string> {
  const system = [
    "You convert a user's casual description of how an AI avatar should look",
    "into ONE precise English instruction for an image-editing model",
    "(flux-kontext-pro). The user text may be in Spanish (often Rioplatense /",
    "Argentine) or other languages — always output English.",
    "Rules:",
    "- Translate faithfully; map regional clothing words correctly",
    "(e.g. 'saco' = blazer/suit jacket, 'remera' = t-shirt, 'campera' = jacket).",
    "- Describe wardrobe and background explicitly, item by item, with colors,",
    "patterns and materials when given. Be concrete, not flowery.",
    "- Only describe what to CHANGE (clothing and/or scene). Do NOT describe the",
    "person's face, age, or body — those must stay as in the source photo.",
    "- If the user says the scene/background stays the same, do not mention the",
    "background at all.",
    "- One sentence, imperative, no preamble, no quotes, under 80 words.",
    "Return ONLY the instruction.",
  ].join(" ");

  return chat(system, freeText);
}
