// src/app/api/studio/tryon/route.ts
// Virtual try-on: upload a garment photo + use the avatar's reference photo,
// transfer the real garment onto the avatar (preserving face/identity/pose and
// the garment's real design/logos), store the result, return a signed URL that
// the Studio uses as the InfiniteTalk input image — same contract as /look.

import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "crypto";
import { authedContext } from "@/lib/studio-auth";
import { GENERATED_CONTENT_BUCKET, REFERENCE_PHOTOS_BUCKET } from "@/lib/avatars";
import { tryOnGarment } from "@/lib/replicate";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { logApiUsage } from "@/lib/usageLog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_GARMENT_BYTES = 8 * 1024 * 1024; // 8 MB

// POST /api/studio/tryon  (multipart/form-data)
//   fields: avatarId (string), garment (File), description (string, optional),
//           baseImagePath (string, optional — choose which avatar photo)
export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const admin = createAdminClient();
  const rl = await checkRateLimit(admin, ctx.accountId, "tryon", { perMinute: 15 });
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
  const description = String(form.get("description") ?? "").slice(0, 200);
  const requestedBase = form.get("baseImagePath");
  const garment = form.get("garment");

  if (!avatarId) return NextResponse.json({ error: "Missing avatar." }, { status: 400 });
  if (!(garment instanceof File)) {
    return NextResponse.json({ error: "Subí una foto de la prenda." }, { status: 400 });
  }
  if (garment.size > MAX_GARMENT_BYTES) {
    return NextResponse.json({ error: "La foto de la prenda supera los 8 MB." }, { status: 400 });
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
    // Upload the garment photo to a temp location in reference-photos.
    const garmentBytes = Buffer.from(await garment.arrayBuffer());
    const garmentHash = createHash("sha256").update(garmentBytes).digest("hex").slice(0, 16);
    const garmentPath = `${prefix}garments/${garmentHash}.png`;
    const { error: gErr } = await ctx.supabase.storage
      .from(REFERENCE_PHOTOS_BUCKET)
      .upload(garmentPath, garmentBytes, { contentType: garment.type || "image/png", upsert: true });
    if (gErr) throw new Error(gErr.message);

    // Signed URLs for both inputs.
    const [{ data: personSigned }, { data: garmentSigned }] = await Promise.all([
      ctx.supabase.storage.from(REFERENCE_PHOTOS_BUCKET).createSignedUrl(personPath, 3600),
      ctx.supabase.storage.from(REFERENCE_PHOTOS_BUCKET).createSignedUrl(garmentPath, 3600),
    ]);
    if (!personSigned?.signedUrl || !garmentSigned?.signedUrl) {
      throw new Error("Could not read the input photos.");
    }

    // Cache by (avatar, person photo, garment hash, description).
    const cacheHash = createHash("sha256")
      .update(`${personPath}|${garmentHash}|${description}`)
      .digest("hex")
      .slice(0, 32);
    const imagePath = `${prefix}looks/tryon_${cacheHash}.png`;

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

    const resultUrl = await tryOnGarment({
      personUrl: personSigned.signedUrl,
      garmentUrl: garmentSigned.signedUrl,
      garmentDescription: description,
    });

    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "replicate",
      route: "tryon",
      costUsdEst: 0.05,
      status: "ok",
    });

    const res = await fetch(resultUrl);
    if (!res.ok) throw new Error(`Could not download the try-on image (${res.status}).`);
    const bytes = Buffer.from(await res.arrayBuffer());

    const { error: upErr } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .upload(imagePath, bytes, { contentType: "image/png", upsert: true });
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
    const message = e instanceof Error ? e.message : "Could not apply the garment.";
    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "replicate",
      route: "tryon",
      costUsdEst: 0,
      status: "error",
      errorMsg: message.slice(0, 500),
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
