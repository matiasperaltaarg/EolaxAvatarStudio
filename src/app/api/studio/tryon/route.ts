// src/app/api/studio/tryon/route.ts  (REPLACE the idm-vton version with this)
// Outfit composition via Gemini (Nano Banana 2). Accepts the avatar's photo +
// 0..N garment reference photos + a text instruction describing the FULL outfit.
// Returns a signed URL the Studio uses as the InfiniteTalk input image — same
// contract as /look.

import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "crypto";
import { authedContext } from "@/lib/studio-auth";
import { GENERATED_CONTENT_BUCKET, REFERENCE_PHOTOS_BUCKET } from "@/lib/avatars";
import { composeOutfit, type RefImage } from "@/lib/gemini-image";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { logApiUsage } from "@/lib/usageLog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IMG_BYTES = 8 * 1024 * 1024; // 8 MB per image
const MAX_GARMENTS = 4;                // Gemini control degrades past ~4 items

async function fileToRef(file: File): Promise<RefImage> {
  const bytes = Buffer.from(await file.arrayBuffer());
  return { base64: bytes.toString("base64"), mimeType: file.type || "image/png" };
}

// POST /api/studio/tryon  (multipart/form-data)
//   avatarId       (string, required)
//   instruction    (string, required) — full outfit description
//   garment        (File, repeatable, optional) — real garment reference photos
//   baseImagePath  (string, optional) — which avatar photo to dress
export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const admin = createAdminClient();
  const rl = await checkRateLimit(admin, ctx.accountId, "tryon", { perMinute: 12 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes de vestuario. Intenta en un minuto." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const avatarId = String(form.get("avatarId") ?? "");
  const instruction = String(form.get("instruction") ?? "").trim().slice(0, 600);
  const requestedBase = form.get("baseImagePath");
  const garmentFiles = form.getAll("garment").filter((g): g is File => g instanceof File);

  if (!avatarId) return NextResponse.json({ error: "Missing avatar." }, { status: 400 });
  if (!instruction) {
    return NextResponse.json(
      { error: "Describí el vestuario (ej: 'camiseta de la foto, short negro y botines blancos')." },
      { status: 400 }
    );
  }
  if (garmentFiles.length > MAX_GARMENTS) {
    return NextResponse.json(
      { error: `Máximo ${MAX_GARMENTS} fotos de prenda por vez.` },
      { status: 400 }
    );
  }
  for (const g of garmentFiles) {
    if (g.size > MAX_IMG_BYTES) {
      return NextResponse.json({ error: "Cada foto de prenda debe pesar menos de 8 MB." }, { status: 400 });
    }
  }

  // Ownership + reference photo.
  const { data: avatar } = await ctx.supabase
    .from("avatars")
    .select("id, reference_photos")
    .eq("id", avatarId)
    .eq("account_id", ctx.accountId)
    .single();
  if (!avatar) return NextResponse.json({ error: "Avatar not found." }, { status: 404 });

  const prefix = `${ctx.accountId}/${avatarId}/`;
  const reqBase = typeof requestedBase === "string" ? requestedBase : undefined;
  const isValidRequested =
    !!reqBase && (avatar.reference_photos?.includes(reqBase) || reqBase.startsWith(prefix));
  const personPath = isValidRequested ? reqBase! : avatar.reference_photos?.[0];
  if (!personPath) {
    return NextResponse.json({ error: "Avatar has no reference photo." }, { status: 400 });
  }

  try {
    // Load the person photo as base64.
    const { data: personBlob } = await ctx.supabase.storage
      .from(REFERENCE_PHOTOS_BUCKET)
      .download(personPath);
    if (!personBlob) throw new Error("Could not read the avatar photo.");
    const personBuf = Buffer.from(await personBlob.arrayBuffer());
    const personImage: RefImage = {
      base64: personBuf.toString("base64"),
      mimeType: personBlob.type || "image/png",
    };

    // Garment reference images (optional).
    const garmentImages: RefImage[] = [];
    const garmentHashes: string[] = [];
    for (const g of garmentFiles) {
      const ref = await fileToRef(g);
      garmentImages.push(ref);
      garmentHashes.push(createHash("sha256").update(ref.base64).digest("hex").slice(0, 12));
    }

    // Cache key: person photo + instruction + garment hashes.
    const cacheHash = createHash("sha256")
      .update(`${personPath}|${instruction}|${garmentHashes.join(",")}`)
      .digest("hex")
      .slice(0, 32);
    const imagePath = `${prefix}looks/outfit_${cacheHash}.png`;

    const { data: cached } = await ctx.supabase
      .from("avatar_look_cache")
      .select("image_path")
      .eq("avatar_id", avatarId)
      .eq("prompt_hash", cacheHash)
      .maybeSingle();
    if (cached?.image_path) {
      const { data: signed } = await ctx.supabase.storage
        .from(GENERATED_CONTENT_BUCKET)
        .createSignedUrl(cached.image_path, 3600);
      if (signed?.signedUrl) {
        return NextResponse.json({ imageUrl: signed.signedUrl, cached: true });
      }
    }

    const out = await composeOutfit({ personImage, garmentImages, instruction });

    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "gemini",
      route: "tryon",
      costUsdEst: 0.07,
      status: "ok",
    });

    const bytes = Buffer.from(out.base64, "base64");
    const { error: upErr } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .upload(imagePath, bytes, { contentType: out.mimeType, upsert: true });
    if (upErr) throw new Error(upErr.message);

    await ctx.supabase
      .from("avatar_look_cache")
      .upsert(
        { avatar_id: avatarId, prompt_hash: cacheHash, image_path: imagePath },
        { onConflict: "avatar_id,prompt_hash" }
      );

    const { data: signed } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .createSignedUrl(imagePath, 3600);

    return NextResponse.json({ imageUrl: signed?.signedUrl ?? null, cached: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not apply the outfit.";
    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "gemini",
      route: "tryon",
      costUsdEst: 0,
      status: "error",
      errorMsg: message.slice(0, 500),
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
