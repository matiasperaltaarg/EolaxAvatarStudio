import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "crypto";
import { authedContext } from "@/lib/studio-auth";
import { GENERATED_CONTENT_BUCKET, REFERENCE_PHOTOS_BUCKET } from "@/lib/avatars";
import { editImage } from "@/lib/replicate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Clause appended to EVERY edit (preset or free) so the avatar's face survives.
const IDENTITY_CLAUSE =
  "Keep the person's face, identity and pose unchanged. Photorealistic.";

const MAX_PROMPT_LEN = 600;

// Collapse whitespace, trim, cap length. Returns "" if nothing usable.
function sanitizePrompt(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT_LEN);
}

// POST /api/studio/look
//   Preset path:  { avatarId, wardrobePresetId, backgroundPresetId }
//   Free path:    { avatarId, freePrompt }
// Applies a look to the avatar's reference photo via flux-kontext-pro and
// caches the result so repeats don't pay for the edit again. Preset looks
// cache by (avatar, wardrobe, background); free looks cache by (avatar,
// prompt_hash). Returns a signed URL of the edited image (the InfiniteTalk
// input image).
export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    avatarId?: string;
    wardrobePresetId?: string;
    backgroundPresetId?: string;
    freePrompt?: string;
  };

  const { avatarId, wardrobePresetId, backgroundPresetId } = body;
  const freePrompt = sanitizePrompt(body.freePrompt);
  const isFree = freePrompt.length > 0;

  if (!avatarId) {
    return NextResponse.json({ error: "Missing avatar." }, { status: 400 });
  }
  if (!isFree && (!wardrobePresetId || !backgroundPresetId)) {
    return NextResponse.json(
      { error: "Pick a wardrobe and a background, or write a free description." },
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

  // --- Build the kontext prompt + the cache lookup for the chosen path. ------
  let prompt: string;
  let cacheQuery;
  let cacheRow: {
    avatar_id: string;
    image_path: string;
    wardrobe_preset_id?: string | null;
    background_preset_id?: string | null;
    prompt_hash?: string | null;
  };
  let imagePath: string;

  if (isFree) {
    prompt = `${freePrompt} ${IDENTITY_CLAUSE}`;
    const promptHash = createHash("sha256").update(freePrompt).digest("hex").slice(0, 32);

    cacheQuery = ctx.supabase
      .from("avatar_look_cache")
      .select("image_path")
      .eq("avatar_id", avatarId)
      .eq("prompt_hash", promptHash)
      .maybeSingle();

    cacheRow = { avatar_id: avatarId, prompt_hash: promptHash, image_path: "" };
    imagePath = `${ctx.accountId}/${avatarId}/looks/free_${promptHash}.png`;
  } else {
    // Preset path — validate both presets belong to this avatar.
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

    prompt = [wardrobe.params?.instruction, background.params?.instruction, IDENTITY_CLAUSE]
      .filter(Boolean)
      .join(" ");

    cacheQuery = ctx.supabase
      .from("avatar_look_cache")
      .select("image_path")
      .eq("avatar_id", avatarId)
      .eq("wardrobe_preset_id", wardrobePresetId)
      .eq("background_preset_id", backgroundPresetId)
      .maybeSingle();

    cacheRow = {
      avatar_id: avatarId,
      wardrobe_preset_id: wardrobePresetId,
      background_preset_id: backgroundPresetId,
      image_path: "",
    };
    imagePath = `${ctx.accountId}/${avatarId}/looks/${wardrobePresetId}_${backgroundPresetId}.png`;
  }

  // --- Cache hit? ------------------------------------------------------------
  const { data: cached } = await cacheQuery;
  if (cached?.image_path) {
    const { data: signed } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .createSignedUrl(cached.image_path, 3600);
    if (signed?.signedUrl) {
      return NextResponse.json({ imageUrl: signed.signedUrl, cached: true });
    }
  }

  // --- Generate, store, cache. -----------------------------------------------
  try {
    const { data: photoSigned } = await ctx.supabase.storage
      .from(REFERENCE_PHOTOS_BUCKET)
      .createSignedUrl(firstPhoto, 3600);
    if (!photoSigned?.signedUrl) throw new Error("Could not read the reference photo.");

    const editedUrl = await editImage({ imageUrl: photoSigned.signedUrl, prompt });

    const res = await fetch(editedUrl);
    if (!res.ok) throw new Error(`Could not download the edited image (${res.status}).`);
    const bytes = Buffer.from(await res.arrayBuffer());

    const { error: upErr } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .upload(imagePath, bytes, { contentType: "image/png", upsert: true });
    if (upErr) throw new Error(upErr.message);

    cacheRow.image_path = imagePath;
    const onConflict = isFree
      ? "avatar_id,prompt_hash"
      : "avatar_id,wardrobe_preset_id,background_preset_id";
    await ctx.supabase.from("avatar_look_cache").upsert(cacheRow, { onConflict });

    const { data: signed } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .createSignedUrl(imagePath, 3600);

    return NextResponse.json({ imageUrl: signed?.signedUrl ?? null, cached: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not apply the look.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
