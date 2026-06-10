// Server-only ElevenLabs client. The API key MUST stay server-side — never
// import this from a Client Component or expose ELEVENLABS_API_KEY publicly.

const API_BASE = "https://api.elevenlabs.io/v1";

// Multilingual model for ES/EN/PT/IT support (CLAUDE.md §2).
export const ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";

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
  const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": getApiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL_ID,
    }),
  });

  if (!res.ok) {
    throw new Error(await readError(res, "Voice preview failed"));
  }

  return res.arrayBuffer();
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
