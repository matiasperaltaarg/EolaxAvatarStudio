// Server-only Replicate client for InfiniteTalk lip-sync video.
// REPLICATE_API_TOKEN must never reach the browser.

const API_BASE = "https://api.replicate.com/v1";

// Lip-sync video model on Replicate: zsxkib/multitalk (MeiGen-AI). For our
// single-speaker case we pass one image + one audio.
//
// zsxkib/multitalk does NOT resolve on the model-name prediction endpoint
// (/v1/models/{owner}/{name}/predictions → 404), so we use the standard
// /v1/predictions endpoint with a PINNED version hash.
//
// Override via REPLICATE_VIDEO_MODEL as "owner/name:version" (the version
// hash is what's actually used). Defaults to the pinned version below so it
// works out of the box.
const DEFAULT_VERSION = "0bd2390c40618c910ffc345b36c8fd218fd8fa59c9124aa641fea443fa203b44";
const MODEL = process.env.REPLICATE_VIDEO_MODEL ?? `zsxkib/multitalk:${DEFAULT_VERSION}`;

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

  // Use the standard /v1/predictions endpoint with a pinned version hash
  // (the model-name endpoint 404s for this model). When an "owner/name:version"
  // value is supplied, the version hash after the colon is what's used.
  const colon = MODEL.indexOf(":");
  let url: string;
  let versionNote: string;
  if (colon >= 0) {
    url = `${API_BASE}/predictions`;
    body.version = MODEL.slice(colon + 1);
    versionNote = MODEL.slice(colon + 1);
  } else {
    // Bare slug with no version — fall back to the model-name endpoint.
    url = `${API_BASE}/models/${MODEL}/predictions`;
    versionNote = "model-name-endpoint";
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
