// Server-only Replicate client for image editing (flux-kontext-pro).
// Used to apply wardrobe/background presets to an avatar's reference photo
// while preserving identity. REPLICATE_API_TOKEN must never reach the browser.

import { inspectFace } from "@/lib/face-guard";

const API_BASE = "https://api.replicate.com/v1";

// Official Black Forest Labs model; the model-name endpoint resolves for it.
// Overridable / pinnable via env ("owner/name" or "owner/name:version").
const KONTEXT_MODEL =
  process.env.REPLICATE_KONTEXT_MODEL ?? "black-forest-labs/flux-kontext-pro";

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

function firstUrl(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Edit an image with a text instruction. Submits the prediction and polls it
// to completion (kontext edits are fast, ~10-20s). Returns the edited image URL.
export async function editImage(input: {
  imageUrl: string;
  prompt: string;
}): Promise<string> {
  const body: Record<string, unknown> = {
    input: {
      input_image: input.imageUrl,
      prompt: input.prompt,
      output_format: "png",
      aspect_ratio: "match_input_image",
      // With an input image, kontext caps safety_tolerance at 2.
      safety_tolerance: 2,
    },
  };

  const colon = KONTEXT_MODEL.indexOf(":");
  let url: string;
  if (colon >= 0) {
    url = `${API_BASE}/predictions`;
    body.version = KONTEXT_MODEL.slice(colon + 1);
  } else {
    url = `${API_BASE}/models/${KONTEXT_MODEL}/predictions`;
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
    console.error(
      `[kontext] submit failed: status=${res.status} model="${KONTEXT_MODEL}" detail=${detail || res.statusText}`
    );
    throw new Error(`Image edit failed (${res.status}): ${detail || res.statusText}`);
  }

  let pred = (await res.json()) as {
    id: string;
    status: string;
    output?: unknown;
    error?: string | null;
  };

  for (let i = 0; i < 30; i++) {
    if (pred.status === "succeeded") {
      const out = firstUrl(pred.output);
      if (!out) throw new Error("Image edit returned no output.");
      return out;
    }
    if (pred.status === "failed" || pred.status === "canceled") {
      throw new Error(`Image edit ${pred.status}${pred.error ? `: ${pred.error}` : ""}`);
    }
    await sleep(2000);
    const poll = await fetch(`${API_BASE}/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
      cache: "no-store",
    });
    if (!poll.ok) {
      const detail = await poll.text().catch(() => "");
      throw new Error(`Image edit poll failed (${poll.status}): ${detail || poll.statusText}`);
    }
    pred = await poll.json();
  }

  throw new Error("Image edit timed out.");
}

// Dedicated face-swap model. Unlike multi-image-kontext (which builds a NEW
// scene from two images and tends to collage), this swaps ONLY the face region
// of the target image, leaving body/pose/clothing/background untouched. That is
// exactly what we want: real face on a chosen body shot, no collage possible.
//
// Default: cdingram/face-swap. Overridable/pinnable via env
// REPLICATE_FACESWAP_MODEL ("owner/name" or "owner/name:version").
const FACESWAP_MODEL =
  process.env.REPLICATE_FACESWAP_MODEL ?? "cdingram/face-swap";

// Swap the face from `faceUrl` onto the person in `bodyUrl`.
// bodyUrl  -> the target image (pose, outfit, framing, background are kept)
// faceUrl  -> the identity source (only the face is taken from here)
// Returns the swapped image URL. Verifies the result has exactly one face
// (reusing inspectFace) before returning; throws FUSION_INVALID otherwise.
export async function fuseFaceAndBody(input: {
  bodyUrl: string;
  faceUrl: string;
}): Promise<string> {
  // Most face-swap models on Replicate use these two input field names.
  // cdingram/face-swap: input_image (target) + swap_image (face source).
  const body: Record<string, unknown> = {
    input: {
      input_image: input.bodyUrl,
      swap_image: input.faceUrl,
    },
  };

  const colon = FACESWAP_MODEL.indexOf(":");
  let url: string;
  if (colon >= 0) {
    url = `${API_BASE}/predictions`;
    body.version = FACESWAP_MODEL.slice(colon + 1);
  } else {
    url = `${API_BASE}/models/${FACESWAP_MODEL}/predictions`;
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
    console.error(
      `[faceswap] submit failed: status=${res.status} model="${FACESWAP_MODEL}" detail=${detail || res.statusText}`
    );
    throw new Error(`Face swap failed (${res.status}): ${detail || res.statusText}`);
  }

  let pred = (await res.json()) as {
    id: string;
    status: string;
    output?: unknown;
    error?: string | null;
  };

  let swappedUrl: string | null = null;
  for (let i = 0; i < 30; i++) {
    if (pred.status === "succeeded") {
      swappedUrl = firstUrl(pred.output);
      break;
    }
    if (pred.status === "failed" || pred.status === "canceled") {
      throw new Error(`Face swap ${pred.status}${pred.error ? `: ${pred.error}` : ""}`);
    }
    await sleep(2000);
    const poll = await fetch(`${API_BASE}/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
      cache: "no-store",
    });
    if (!poll.ok) {
      const detail = await poll.text().catch(() => "");
      throw new Error(`Face swap poll failed (${poll.status}): ${detail || poll.statusText}`);
    }
    pred = await poll.json();
  }

  if (!swappedUrl) throw new Error("Face swap returned no output (timed out).");

  // Verify: a correct swap keeps the single body, so it must read as ONE face,
  // not a collage. (Face-swap models don't collage, but this is a cheap belt-
  // and-suspenders check before the image can ever reach a paid video render.)
  const check = await inspectFace(swappedUrl);
  if (!check.ok) {
    throw new Error(
      `FUSION_INVALID: face swap produced ${check.faceCount} face(s)` +
        `${check.isCollage ? " as a collage" : ""}. ${check.reason}`
    );
  }

  return swappedUrl;
}
