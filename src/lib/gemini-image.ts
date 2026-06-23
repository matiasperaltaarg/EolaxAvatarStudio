// src/lib/gemini-image.ts
// Outfit editing via Google's Gemini image model (Nano Banana 2).
// Unlike dedicated VTON models (idm-vton) that only swap a single top and
// distort the rest, Gemini is a generative editor: it takes the person photo +
// one or more garment reference photos + a text instruction, and produces ONE
// image of the SAME person wearing the FULL requested outfit — preserving face,
// identity and pose, and faithfully transferring real garment designs (crest,
// sponsor, colours) from the reference photos.
//
// Model is env-configurable so it can be upgraded without a code change:
//   GEMINI_IMAGE_MODEL  (default "gemini-3.1-flash-image-preview" = Nano Banana 2)
// Requires GEMINI_API_KEY (server-side only).

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL =
  process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image-preview";

function getKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY (server-side).");
  return key;
}

export type RefImage = { base64: string; mimeType: string };

// Compose an outfit on a person.
//   personImage  : the avatar's photo (identity/pose to preserve)
//   garmentImages: zero or more reference photos of real garments to apply
//   instruction  : natural-language outfit description (covers garments without
//                  a reference photo, e.g. "black shorts and white sneakers")
// Returns the edited image as { base64, mimeType }.
export async function composeOutfit(input: {
  personImage: RefImage;
  garmentImages?: RefImage[];
  instruction: string;
}): Promise<RefImage> {
  const garments = input.garmentImages ?? [];

  // Build a precise prompt. Identity preservation is explicit; garment
  // references are pointed to by order ("the first garment photo", etc.).
  const refNote =
    garments.length > 0
      ? ` Use the ${garments.length === 1 ? "garment photo provided" : `${garments.length} garment photos provided`} as the exact reference for those clothing items — copy their real design, colours, logos, crest and text faithfully, do not invent or alter them.`
      : "";

  const promptText =
    `Edit the FIRST image (the person). Keep the same face, identity, hair, ` +
    `body and pose exactly unchanged. Dress this person in the following ` +
    `complete outfit: ${input.instruction}.${refNote} ` +
    `Produce ONE single photorealistic image of this same person wearing the ` +
    `full outfit, with natural fit, fabric folds, seams and shadows. ` +
    `Do not change the background or the person's identity.`;

  // parts: [text, personImage, ...garmentImages]
  const parts: unknown[] = [
    { text: promptText },
    { inline_data: { mime_type: input.personImage.mimeType, data: input.personImage.base64 } },
  ];
  for (const g of garments) {
    parts.push({ inline_data: { mime_type: g.mimeType, data: g.base64 } });
  }

  const res = await fetch(
    `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": getKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(
      `[gemini-image] failed: status=${res.status} model="${GEMINI_MODEL}" detail=${detail || res.statusText}`
    );
    throw new Error(`Outfit edit failed (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }[] } }[];
  };

  const outParts = data.candidates?.[0]?.content?.parts ?? [];
  for (const p of outParts) {
    // SDKs vary: inlineData (camel) or inline_data (snake).
    const inline = p.inlineData ?? p.inline_data;
    const b64 = inline?.data;
    const mime =
      (p.inlineData?.mimeType) ?? (p.inline_data?.mime_type) ?? "image/png";
    if (b64) return { base64: b64, mimeType: mime };
  }

  throw new Error("Outfit edit returned no image.");
}
