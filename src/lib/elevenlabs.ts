// Server-only ElevenLabs client. The API key MUST stay server-side — never
// import this from a Client Component or expose ELEVENLABS_API_KEY publicly.

const API_BASE = "https://api.elevenlabs.io/v1";

// Eleven v3: most expressive model, designed for natural prosody and audio
// tags ([excited], [pausa], …). Replaces multilingual_v2 (which read scripts
// flat/robotic). Works with Instant Voice Clones. Overridable via env so we can
// fall back to multilingual_v2 if needed for A/B or fidelity issues.
export const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID ?? "eleven_v3";

function isV3(modelId: string): boolean {
  return modelId.includes("_v3");
}

// High-quality TTS output: 44.1 kHz, 128 kbps MP3 (clean, supported on every
// plan). Override to mp3_44100_192 on Creator+ tiers for 192 kbps.
const OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT ?? "mp3_44100_128";

// Voice settings — tuned for natural, expressive speech (robotic output is
// usually stability set too high). Easy to A/B via env overrides.
//   stability        lower = more expressive/varied, higher = flatter/robotic
//   similarity_boost  adherence to the cloned voice timbre
//   style             stylistic exaggeration (0 = none)
//   use_speaker_boost  boosts similarity to the original speaker
const VOICE_SETTINGS = {
  stability: numEnv("ELEVENLABS_STABILITY", 0.45),
  similarity_boost: numEnv("ELEVENLABS_SIMILARITY", 0.75),
  style: numEnv("ELEVENLABS_STYLE", 0.35),
  use_speaker_boost: process.env.ELEVENLABS_SPEAKER_BOOST !== "false",
};

// Voice cloning is done on Spanish samples, so non-Spanish output tends to
// drift into a wrong/foreign accent. We keep the cloned timbre while letting
// language_code drive correct pronunciation.
//
// v3 uses stability MODES ("natural" | "creative" | "robust") instead of v2's
// numeric slider, has no speaker_boost, and responds to audio tags only when
// NOT in "robust". We use "natural" for Spanish (closest to the original voice,
// still expressive) and "robust" for other languages (max timbre stability to
// fight accent drift; tags matter less there).
function settingsForLanguage(languageCode?: string) {
  const isSpanish = !languageCode || languageCode.toLowerCase().startsWith("es");

  if (isV3(ELEVENLABS_MODEL_ID)) {
    return {
      stability: process.env.ELEVENLABS_V3_STABILITY ?? (isSpanish ? "natural" : "robust"),
      similarity_boost: numEnv("ELEVENLABS_SIMILARITY", 0.75),
      style: numEnv(isSpanish ? "ELEVENLABS_STYLE" : "ELEVENLABS_STYLE_NONES", isSpanish ? 0.35 : 0.0),
    };
  }

  // v2 (numeric slider + speaker_boost)
  if (isSpanish) return VOICE_SETTINGS;
  return {
    ...VOICE_SETTINGS,
    stability: numEnv("ELEVENLABS_STABILITY_NONES", 0.75),
    style: numEnv("ELEVENLABS_STYLE_NONES", 0.0),
  };
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error(
      "Missing ELEVENLABS_API_KEY. Set it server-side (Vercel → Project " +
        "Settings → Environment Variables). It must NOT be a NEXT_PUBLIC_ var."
    );
  }
  return key;
}

// Instant Voice Cloning — POST /v1/voices/add with audio samples.
// Returns the new ElevenLabs voice_id.
export async function addVoice(name: string, files: File[]): Promise<string> {
  const form = new FormData();
  form.append("name", name);
  form.append(
    "description",
    "Eolax Avatar Studio cloned voice (brand-exclusive avatar)."
  );
  for (const file of files) {
    form.append("files", file, file.name || "sample");
  }

  const res = await fetch(`${API_BASE}/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": getApiKey() },
    body: form,
  });

  if (!res.ok) {
    throw new Error(await readError(res, "Voice cloning failed"));
  }

  const json = (await res.json()) as { voice_id?: string };
  if (!json.voice_id) {
    throw new Error("ElevenLabs did not return a voice_id.");
  }
  return json.voice_id;
}

// DELETE /v1/voices/{voice_id}. Best-effort — used when re-cloning.
export async function deleteVoice(voiceId: string): Promise<void> {
  await fetch(`${API_BASE}/voices/${voiceId}`, {
    method: "DELETE",
    headers: { "xi-api-key": getApiKey() },
  }).catch(() => {
    // Ignore: the old voice may already be gone; not worth failing a re-clone.
  });
}

// POST /v1/text-to-speech/{voice_id}. Returns MP3 audio bytes.
export async function textToSpeech(
  voiceId: string,
  text: string
): Promise<ArrayBuffer> {
  const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    headers: {
      "xi-api-key": getApiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL_ID,
      voice_settings: VOICE_SETTINGS,
    }),
  });

  if (!res.ok) {
    throw new Error(await readError(res, "Voice preview failed"));
  }

  return res.arrayBuffer();
}

// POST /v1/text-to-speech/{voice_id}/with-timestamps. Returns the MP3 bytes
// plus the ACTUAL audio duration in seconds (from the character alignment),
// so the video step and the videos.duration_seconds column are accurate.
export async function textToSpeechWithDuration(
  voiceId: string,
  text: string,
  languageCode?: string
): Promise<{ audio: Buffer; durationSeconds: number }> {
  const res = await fetch(
    `${API_BASE}/text-to-speech/${voiceId}/with-timestamps?output_format=${OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": getApiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
        ...(languageCode ? { language_code: languageCode } : {}),
        voice_settings: settingsForLanguage(languageCode),
      }),
    }
  );

  if (!res.ok) {
    throw new Error(await readError(res, "Voice generation failed"));
  }

  const json = (await res.json()) as {
    audio_base64?: string;
    alignment?: { character_end_times_seconds?: number[] };
    normalized_alignment?: { character_end_times_seconds?: number[] };
  };

  if (!json.audio_base64) {
    throw new Error("ElevenLabs returned no audio.");
  }

  const ends =
    json.alignment?.character_end_times_seconds ??
    json.normalized_alignment?.character_end_times_seconds ??
    [];
  const last = ends.length > 0 ? ends[ends.length - 1] : 0;
  // Keep one decimal of precision; never report less than 1s.
  const durationSeconds = Math.max(1, Math.round(last * 10) / 10);

  return { audio: Buffer.from(json.audio_base64, "base64"), durationSeconds };
}

async function readError(res: Response, prefix: string): Promise<string> {
  let detail = "";
  try {
    const body = await res.json();
    detail =
      body?.detail?.message ??
      (typeof body?.detail === "string" ? body.detail : "") ??
      JSON.stringify(body);
  } catch {
    detail = await res.text().catch(() => "");
  }
  return `${prefix} (${res.status}): ${detail || res.statusText}`;
}
