// Server-only Replicate client for InfiniteTalk lip-sync video.
// REPLICATE_API_TOKEN must never reach the browser.

const API_BASE = "https://api.replicate.com/v1";

// InfiniteTalk model on Replicate. Overridable via env in case the slug or
// version changes — the deploy-first workflow can then fix it without a code
// change. Format: "owner/name" (latest version) or "owner/name:version".
const MODEL = process.env.REPLICATE_INFINITETALK_MODEL ?? "zsxkib/infinite-talk";

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

// Start an InfiniteTalk prediction. Returns immediately with the prediction
// id; poll getPrediction() for completion (the client drives the polling).
export async function startInfiniteTalk(input: {
  imageUrl: string;
  audioUrl: string;
  resolution?: "480p" | "720p";
  prompt?: string;
}): Promise<Prediction> {
  const body: Record<string, unknown> = {
    input: {
      image: input.imageUrl,
      audio: input.audioUrl,
      resolution: input.resolution ?? "480p",
      prompt: input.prompt ?? "A person talking directly to the camera.",
    },
  };

  // If a pinned version is supplied (owner/name:version), use the generic
  // /predictions endpoint; otherwise run the model's latest version.
  const colon = MODEL.indexOf(":");
  let url: string;
  if (colon >= 0) {
    url = `${API_BASE}/predictions`;
    body.version = MODEL.slice(colon + 1);
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
