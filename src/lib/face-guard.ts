// src/lib/face-guard.ts
// Guard that verifies an image contains EXACTLY ONE human face before it is
// sent to InfiniteTalk. This catches the failure mode where multi-image-kontext
// returns a side-by-side COLLAGE of the two input photos instead of a single
// fused person — which would otherwise produce a broken talking-head video
// (two faces, or the model animating dead center between them).
//
// Uses a vision LLM via OpenRouter (already configured for this project) rather
// than adding a new face-detection dependency. Cheap (~USD 0.001/call) and runs
// only at the moments that matter: right after fusion, and right before paying
// for a video.

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";

// A vision-capable model. Override via env if needed.
const VISION_MODEL =
  process.env.OPENROUTER_VISION_MODEL ?? "anthropic/claude-3.5-sonnet";

export type FaceCheck = {
  faceCount: number;
  isCollage: boolean;
  ok: boolean; // true only when exactly one face and not a collage
  reason: string;
};

function getKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Missing OPENROUTER_API_KEY (server-side).");
  return key;
}

// Inspect an image URL and report how many distinct human faces it contains and
// whether it looks like a multi-panel collage. Fails OPEN on inspection error
// (returns ok:true) so a transient vision-API hiccup never blocks a legitimate
// video — the real protection is the happy path, not a hard gate that can strand
// the user. Set FACE_GUARD_STRICT=1 to fail closed instead.
export async function inspectFace(imageUrl: string): Promise<FaceCheck> {
  const strict = process.env.FACE_GUARD_STRICT === "1";
  try {
    const res = await fetch(OPENROUTER_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "You are validating an image that will be used as the single " +
                  "source frame for a talking-head video. Reply ONLY with a JSON " +
                  'object, no prose: {"faceCount": <int>, "isCollage": <bool>, ' +
                  '"reason": "<short>"}. faceCount = number of distinct human ' +
                  "faces visible. isCollage = true if the image is two or more " +
                  "separate photos placed side by side or in panels (a montage), " +
                  "false if it is one single natural photograph of one scene.",
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      return {
        faceCount: 1,
        isCollage: false,
        ok: !strict ? true : false,
        reason: `vision inspect failed (${res.status})`,
      };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const json = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(json) as {
      faceCount?: number;
      isCollage?: boolean;
      reason?: string;
    };

    const faceCount = Number.isFinite(parsed.faceCount) ? Number(parsed.faceCount) : 1;
    const isCollage = parsed.isCollage === true;
    const ok = faceCount === 1 && !isCollage;

    return {
      faceCount,
      isCollage,
      ok,
      reason: parsed.reason ?? (ok ? "single face" : "rejected"),
    };
  } catch (e) {
    // Parsing/network error → fail open (unless strict) so we never strand a
    // legitimate generation on an inspection glitch.
    return {
      faceCount: 1,
      isCollage: false,
      ok: !strict ? true : false,
      reason: e instanceof Error ? e.message : "inspect error",
    };
  }
}

// Human-readable message for the UI when a guard rejects an image.
export function faceRejectionMessage(check: FaceCheck): string {
  if (check.isCollage || check.faceCount > 1) {
    return (
      "La imagen final contiene más de una persona o quedó como un collage de " +
      "dos fotos. El video necesita una sola imagen con un solo rostro. " +
      "Volvé a aplicar la fusión cara+cuerpo o elegí una foto distinta."
    );
  }
  if (check.faceCount === 0) {
    return "No se detectó ningún rostro en la imagen final. Elegí una foto donde se vea claramente la cara.";
  }
  return "La imagen final no es válida para generar el video.";
}
