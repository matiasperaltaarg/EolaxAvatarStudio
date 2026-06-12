// Server-only Replicate client for image editing (flux-kontext-pro).
// Used to apply wardrobe/background presets to an avatar's reference photo
// while preserving identity. REPLICATE_API_TOKEN must never reach the browser.

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

// Multi-image kontext model: fuses TWO input images into one. We use it to put
// a high-fidelity FACE (close-up) onto a BODY/POSE photo, so the talking-head
// video keeps the real person's likeness even when the body shot has a small
// face. Overridable/pinnable via env.
const MULTI_KONTEXT_MODEL =
  process.env.REPLICATE_MULTI_KONTEXT_MODEL ??
  "flux-kontext-apps/multi-image-kontext-max";

// Fuse a face reference onto a body/pose image. bodyUrl is image 1 (keeps pose,
// outfit, framing, background); faceUrl is image 2 (the identity source).
// Returns the fused image URL. Submits + polls like editImage.
export async function fuseFaceAndBody(input: {
  bodyUrl: string;
  faceUrl: string;
  prompt?: string;
}): Promise<string> {
  const prompt =
    input.prompt ??
    "Replace the face of the person in the first image with the face from the " +
      "second image. Keep the body, pose, clothing, framing and background of the " +
      "first image exactly the same. Match skin tone and lighting. Photorealistic, " +
      "natural, seamless blend.";

  const body: Record<string, unknown> = {
    input: {
      input_image_1: input.bodyUrl,
      input_image_2: input.faceUrl,
      prompt,
      output_format: "png",
      aspect_ratio: "match_input_image",
      safety_tolerance: 2,
    },
  };

  const colon = MULTI_KONTEXT_MODEL.indexOf(":");
  let url: string;
  if (colon >= 0) {
    url = `${API_BASE}/predictions`;
    body.version = MULTI_KONTEXT_MODEL.slice(colon + 1);
  } else {
    url = `${API_BASE}/models/${MULTI_KONTEXT_MODEL}/predictions`;
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
      `[kontext-multi] submit failed: status=${res.status} model="${MULTI_KONTEXT_MODEL}" detail=${detail || res.statusText}`
    );
    throw new Error(`Face fusion failed (${res.status}): ${detail || res.statusText}`);
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
      if (!out) throw new Error("Face fusion returned no output.");
      return out;
    }
    if (pred.status === "failed" || pred.status === "canceled") {
      throw new Error(`Face fusion ${pred.status}${pred.error ? `: ${pred.error}` : ""}`);
    }
    await sleep(2000);
    const poll = await fetch(`${API_BASE}/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
      cache: "no-store",
    });
    if (!poll.ok) {
      const detail = await poll.text().catch(() => "");
      throw new Error(`Face fusion poll failed (${poll.status}): ${detail || poll.statusText}`);
    }
    pred = await poll.json();
  }

  throw new Error("Face fusion timed out.");
}
