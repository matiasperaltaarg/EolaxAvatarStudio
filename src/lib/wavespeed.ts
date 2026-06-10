// Server-only WaveSpeedAI client for InfiniteTalk lip-sync video.
// WAVESPEED_API_KEY must never reach the browser. InfiniteTalk takes one
// image + one audio and renders a talking video matching the FULL audio
// length (up to ~10 min) in a single call — no per-clip frame cap.

const SUBMIT_URL = "https://api.wavespeed.ai/api/v3/wavespeed-ai/infinitetalk";
const RESULT_URL = (id: string) =>
  `https://api.wavespeed.ai/api/v3/predictions/${id}/result`;

// 720p for production sharpness (~$0.06/sec). Set WAVESPEED_RESOLUTION=480p
// to halve cost during iteration. InfiniteTalk exposes no other quality knobs
// (no sampling-steps / audio sample-rate params).
const RESOLUTION = process.env.WAVESPEED_RESOLUTION ?? "720p";

export type VideoStatus = "processing" | "succeeded" | "failed";

export class VideoModelUnavailableError extends Error {
  constructor() {
    super("video model unavailable");
    this.name = "VideoModelUnavailableError";
  }
}

function getApiKey(): string {
  const key = process.env.WAVESPEED_API_KEY;
  if (!key) {
    throw new Error(
      "Missing WAVESPEED_API_KEY. Set it server-side (Vercel → Project " +
        "Settings → Environment Variables)."
    );
  }
  return key;
}

// Submit a generation task. Returns the prediction id to poll.
export async function submitInfiniteTalk(input: {
  imageUrl: string;
  audioUrl: string;
  prompt?: string;
}): Promise<string> {
  const body = {
    image: input.imageUrl,
    audio: input.audioUrl,
    prompt:
      input.prompt ??
      "A person looking at the camera and talking, with natural facial expressions.",
    resolution: RESOLUTION,
  };

  const res = await fetch(SUBMIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(
      `[wavespeed] submit failed: status=${res.status} url="${SUBMIT_URL}" ` +
        `resolution="${RESOLUTION}" detail=${detail || res.statusText}`
    );
    if (res.status === 404) throw new VideoModelUnavailableError();
    throw new Error(`WaveSpeed submit failed (${res.status}): ${detail || res.statusText}`);
  }

  const json = await res.json();
  const id = json?.data?.id ?? json?.id;
  if (!id) {
    console.error(`[wavespeed] submit returned no id: ${JSON.stringify(json)}`);
    throw new Error("WaveSpeed did not return a prediction id.");
  }
  return id as string;
}

// Poll a task. Maps WaveSpeed's status vocabulary onto our pipeline's.
export async function getInfiniteTalkResult(
  id: string
): Promise<{ status: VideoStatus; videoUrl: string | null; error: string | null }> {
  const res = await fetch(RESULT_URL(id), {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(
      `[wavespeed] result failed: status=${res.status} id="${id}" detail=${detail || res.statusText}`
    );
    throw new Error(`WaveSpeed poll failed (${res.status}): ${detail || res.statusText}`);
  }

  const json = await res.json();
  const data = json?.data ?? json;
  const raw: string = data?.status ?? "processing";
  const outputs: unknown = data?.outputs;
  const videoUrl =
    Array.isArray(outputs) && typeof outputs[0] === "string" ? (outputs[0] as string) : null;

  if (raw === "completed") {
    if (!videoUrl) {
      return { status: "failed", videoUrl: null, error: "No output video was returned." };
    }
    return { status: "succeeded", videoUrl, error: null };
  }
  if (raw === "failed") {
    return { status: "failed", videoUrl: null, error: data?.error || "Generation failed." };
  }
  // created / processing / queued / anything else → still in progress.
  return { status: "processing", videoUrl: null, error: null };
}
