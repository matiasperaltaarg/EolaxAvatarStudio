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

async function chat(system: string, user: string, temperature = 0.7): Promise<string> {
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
      temperature,
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

// Adjust a script's DELIVERY for spoken/TTS fluency (ElevenLabs v3) without
// rewriting its content. This is NOT a copywriter rewrite — the user's exact
// words, wording, register and length must be preserved. v3 already handles
// natural prosody from punctuation/casing/audio-tags, so we lean on that
// instead of phonetic spellings (e.g. "amooor"), which are a legacy TTS trick
// this model doesn't need.
export async function improveScript(
  script: string,
  personality: string | null
): Promise<string> {
  const personalityNote = personality
    ? `The avatar's personality/tone (do not use this to change wording, only as context): "${personality}".`
    : "";

  const system = [
    "You are a delivery/fluency editor for a script that will be read aloud",
    "by an ElevenLabs v3 text-to-speech voice. Your ONLY job is to make the",
    "text read more naturally and fluidly out loud — you are NOT a copywriter",
    "and must NOT rewrite, rephrase, shorten, summarize, add or remove content.",
    "",
    "STRICT RULES:",
    "- Keep every single word the user wrote, in the same order and register",
    "(including slang, regionalisms, elongated words like 'amooor', informal",
    "spelling, etc.). Do not swap words for synonyms and do not paraphrase.",
    "- Do not shorten or condense. Do not add a new hook, CTA, or any sentence",
    "that wasn't already there in some form.",
    "- You MAY adjust: punctuation (commas, ellipses '…' for pauses, periods",
    "to break run-on sentences into breath-sized chunks), capitalization for",
    "emphasis on a word ElevenLabs v3 should stress, and line breaks.",
    "- You MAY insert ElevenLabs v3 audio tags in brackets (e.g. [laughs],",
    "[pausa], [suspiro], [enfático]) ONLY where the tone clearly calls for it —",
    "use them sparingly, never more than one every few sentences.",
    "- Do NOT invent phonetic spellings or repeat letters that weren't already",
    "in the original text (e.g. don't turn 'amor' into 'amooor' yourself) —",
    "v3 reads emotional emphasis correctly from normal punctuation and tags;",
    "only preserve elongations the user already wrote.",
    personalityNote,
    "Return ONLY the adjusted script text, with no preamble, quotes or commentary.",
  ]
    .filter(Boolean)
    .join(" ");

  // Lower temperature than the default: this task should behave like a
  // deterministic formatter, not a creative rewrite.
  return chat(system, script, 0.2);
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

// Enrich a script with ElevenLabs v3 audio tags + expressive punctuation so the
// cloned voice sounds natural (not flat/robotic) instead of reading verbatim.
// Runs AFTER translation, on the final-language text, right before TTS.
// languageEnglishName matches the director instructions to the language.
// accentTag (optional) is an ElevenLabs accent tag like "[Spanish accent]" that,
// when set, is placed at the START of the script to bias regional pronunciation.
export async function enrichForNaturalSpeech(
  text: string,
  languageEnglishName: string,
  accentTag?: string
): Promise<string> {
  const accentLine = accentTag
    ? `- At the very START of the output, prepend the accent tag ${accentTag} exactly once (before the first word). This is the only addition allowed before the text.`
    : "";

  const system = [
    `You are a TTS markup tool for ElevenLabs v3 in ${languageEnglishName}.`,
    "Your ONLY job is to ADD punctuation and bracketed performance cues BETWEEN the",
    "existing words. You are FORBIDDEN from changing the words themselves.",
    "",
    "ABSOLUTE RULES — these override everything else:",
    "- Output every original word EXACTLY as written, in the same order, with the same",
    "  spelling. Do NOT replace, translate, paraphrase, soften, censor, formalize, or",
    "  'improve' ANY word. Slang, informal phrasing, regional words and profanity MUST",
    "  remain verbatim (e.g. do not change 'carajo', 'joda', 'hacete', 'che').",
    "- Do NOT add or remove words. The word sequence must be identical to the input.",
    "",
    "WHAT YOU MAY ADD (only between/around the unchanged words):",
    "- Punctuation for natural rhythm: commas, periods, ellipses (…), exclamation marks,",
    "  em dashes (—).",
    "- ElevenLabs audio tags in square brackets, e.g. [warmly], [excited], [serious],",
    "  [reassuring], [short pause]. Use AT MOST one tag every 1-2 sentences.",
    accentLine,
    "- Tags stay in English; the spoken words stay in the original language, verbatim.",
    "",
    "Think of it as inserting markup into a locked transcript: you may add symbols and",
    "[tags] in the gaps, never edit the words. Do NOT wrap output in quotes or add",
    "commentary. Return ONLY the marked-up script.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await chat(system, text);

  // SAFETY NET: verify the model didn't alter the words. Strip tags, punctuation
  // and accent markup from the result, then compare the bare word sequence to the
  // original. If they differ, the enrichment misbehaved — discard it and use the
  // user's exact text, so the spoken script ALWAYS matches what was written.
  if (!wordsPreserved(text, result)) {
    console.warn("[enrich] word mismatch — falling back to original script");
    return text;
  }
  return result;
}

// Compare the word content of original vs enriched, ignoring anything the
// enrichment is allowed to add: [bracket tags], punctuation, and extra spaces.
function wordsPreserved(original: string, enriched: string): boolean {
  const normalize = (s: string) =>
    s
      .replace(/\[[^\]]*\]/g, " ")          // remove [audio tags]
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")       // strip accents (é → e)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")     // strip punctuation/symbols
      .replace(/\s+/g, " ")
      .trim();

  const a = normalize(original).split(" ").filter(Boolean);
  const b = normalize(enriched).split(" ").filter(Boolean);

  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
