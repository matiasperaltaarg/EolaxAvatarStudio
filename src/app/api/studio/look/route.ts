import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { GENERATED_CONTENT_BUCKET, REFERENCE_PHOTOS_BUCKET } from "@/lib/avatars";
import { editImage } from "@/lib/replicate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/studio/look  { avatarId, wardrobePresetId, backgroundPresetId }
// Applies the chosen wardrobe + background presets to the avatar's reference
// photo via flux-kontext-pro, caching the result per (avatar, wardrobe,
// background) combo so repeat combos don't pay for the edit again. Returns a
// signed URL of the edited image, used as the InfiniteTalk input image.
export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { avatarId, wardrobePresetId, backgroundPresetId } = (await request
    .json()
    .catch(() => ({}))) as {
    avatarId?: string;
    wardrobePresetId?: string;
    backgroundPresetId?: string;
  };

  if (!avatarId || !wardrobePresetId || !backgroundPresetId) {
    return NextResponse.json(
      { error: "Pick one wardrobe and one background preset." },
      { status: 400 }
    );
  }

  // Ownership + reference photo.
  const { data: avatar } = await ctx.supabase
    .from("avatars")
    .select("id, reference_photos")
    .eq("id", avatarId)
    .eq("account_id", ctx.accountId)
    .single();
  if (!avatar) return NextResponse.json({ error: "Avatar not found." }, { status: 404 });
  const firstPhoto = avatar.reference_photos?.[0];
  if (!firstPhoto) {
    return NextResponse.json({ error: "Avatar has no reference photo." }, { status: 400 });
  }

  // Cache hit?
  const { data: cached } = await ctx.supabase
    .from("avatar_look_cache")
    .select("image_path")
    .eq("avatar_id", avatarId)
    .eq("wardrobe_preset_id", wardrobePresetId)
    .eq("background_preset_id", backgroundPresetId)
    .maybeSingle();

  if (cached?.image_path) {
    const { data: signed } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .createSignedUrl(cached.image_path, 3600);
    if (signed?.signedUrl) {
      return NextResponse.json({ imageUrl: signed.signedUrl, cached: true });
    }
  }

  // Load both presets (validate they belong to this avatar).
  const { data: wardrobe } = await ctx.supabase
    .from("wardrobe_presets")
    .select("label, params")
    .eq("id", wardrobePresetId)
    .eq("avatar_id", avatarId)
    .single();
  const { data: background } = await ctx.supabase
    .from("background_presets")
    .select("label, params")
    .eq("id", backgroundPresetId)
    .eq("avatar_id", avatarId)
    .single();

  if (!wardrobe || !background) {
    return NextResponse.json({ error: "Preset not found for this avatar." }, { status: 404 });
  }

  const prompt = [
    wardrobe.params?.instruction,
    background.params?.instruction,
    "Keep the person's face, identity and pose unchanged. Photorealistic.",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const { data: photoSigned } = await ctx.supabase.storage
      .from(REFERENCE_PHOTOS_BUCKET)
      .createSignedUrl(firstPhoto, 3600);
    if (!photoSigned?.signedUrl) throw new Error("Could not read the reference photo.");

    const editedUrl = await editImage({ imageUrl: photoSigned.signedUrl, prompt });

    // Download + store the edited image.
    const res = await fetch(editedUrl);
    if (!res.ok) throw new Error(`Could not download the edited image (${res.status}).`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const imagePath = `${ctx.accountId}/${avatarId}/looks/${wardrobePresetId}_${backgroundPresetId}.png`;

    const { error: upErr } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .upload(imagePath, bytes, { contentType: "image/png", upsert: true });
    if (upErr) throw new Error(upErr.message);

    // Cache the combo (ignore conflicts from concurrent requests).
    await ctx.supabase
      .from("avatar_look_cache")
      .upsert(
        {
          avatar_id: avatarId,
          wardrobe_preset_id: wardrobePresetId,
          background_preset_id: backgroundPresetId,
          image_path: imagePath,
        },
        { onConflict: "avatar_id,wardrobe_preset_id,background_preset_id" }
      );

    const { data: signed } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .createSignedUrl(imagePath, 3600);

    return NextResponse.json({ imageUrl: signed?.signedUrl ?? null, cached: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not apply the look.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
