// Server-only Replicate client for InfiniteTalk lip-sync video.
// REPLICATE_API_TOKEN must never reach the browser.

const API_BASE = "https://api.replicate.com/v1";

// Lip-sync video model on Replicate: zsxkib/multitalk (MeiGen-AI). For our
// single-speaker case we pass one image + one audio. Overridable via env in
// case the slug/version changes; format "owner/name" (latest version) or
// "owner/name:version" to pin. Default uses the model-name endpoint so we
// always run the model's CURRENT latest version (no stale version hash).
const MODEL = process.env.REPLICATE_VIDEO_MODEL ?? "zsxkib/multitalk";

// Thrown when Replicate reports the model/version is missing (404), so the
// route can show a clean "video model unavailable" message.
export class VideoModelUnavailableError extends Error {
  constructor(public modelId: string) {
    super("video model unavailable");
    this.name = "VideoModelUnavailableError";
  }
}

export type PredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export type Prediction = {
  id: string;
  status: PredictionStatus;
  output: unknown;
  error: string | null;
};

function getToken(): string {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error(
      "Missing REPLICATE_API_TOKEN. Set it server-side (Vercel → Project " +
        "Settings → Environment Variables)."
    );
  }
  return token;
}

// Start a lip-sync prediction (single speaker = one image + one audio).
// Returns immediately with the prediction id; poll getPrediction() for
// completion (the client drives the polling).
export async function startLipsyncVideo(input: {
  imageUrl: string;
  audioUrl: string;
  prompt?: string;
}): Promise<Prediction> {
  // zsxkib/multitalk input schema: image, first_audio (+ optional
  // second_audio for multi-person, which we don't use), prompt.
  const body: Record<string, unknown> = {
    input: {
      image: input.imageUrl,
      first_audio: input.audioUrl,
      prompt:
        input.prompt ??
        "A person looking at the camera and talking, with natural facial expressions.",
    },
  };

  // If a pinned version is supplied (owner/name:version), use the generic
  // /predictions endpoint; otherwise run the model's latest version via the
  // model-name endpoint (avoids stale version hashes — itself a 404 cause).
  const colon = MODEL.indexOf(":");
  let url: string;
  let versionNote = "latest";
  if (colon >= 0) {
    url = `${API_BASE}/predictions`;
    body.version = MODEL.slice(colon + 1);
    versionNote = MODEL.slice(colon + 1);
  } else {
    url = `${API_BASE}/models/${MODEL}/predictions`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Log the full identifier/endpoint server-side for debugging.
    console.error(
      `[replicate] start failed: status=${res.status} model="${MODEL}" ` +
        `version="${versionNote}" url="${url}" detail=${detail || res.statusText}`
    );
    if (res.status === 404) {
      throw new VideoModelUnavailableError(MODEL);
    }
    throw new Error(`Replicate start failed (${res.status}): ${detail || res.statusText}`);
  }

  return normalize(await res.json());
}

export async function getPrediction(id: string): Promise<Prediction> {
  const res = await fetch(`${API_BASE}/predictions/${id}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Replicate poll failed (${res.status}): ${detail || res.statusText}`);
  }
  return normalize(await res.json());
}

// InfiniteTalk output may be a URL string or an array of URLs. Return the
// first video URL.
export function firstOutputUrl(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.length > 0 && typeof output[0] === "string") {
    return output[0];
  }
  return null;
}

function normalize(raw: unknown): Prediction {
  const p = raw as {
    id: string;
    status: PredictionStatus;
    output?: unknown;
    error?: string | null;
  };
  return {
    id: p.id,
    status: p.status,
    output: p.output ?? null,
    error: p.error ?? null,
  };
}
