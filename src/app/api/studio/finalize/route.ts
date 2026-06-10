import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { GENERATED_CONTENT_BUCKET } from "@/lib/avatars";
import { burnVideoMarks } from "@/lib/overlay";
import { createAdminClient } from "@/lib/supabase/admin";
import { debitForVideo, secondsToCharge } from "@/lib/credits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/studio/finalize
// Downloads the finished video, burns the optional on-screen text overlay,
// stores it privately, creates the `videos` row (status='ready'), and returns
// a signed playback/download URL.
export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    avatarId?: string;
    jobId?: string;
    language?: string;
    aspectRatio?: string;
    originalScript?: string;
    durationSeconds?: number;
    videoUrl?: string;
    wardrobePresetId?: string | null;
    backgroundPresetId?: string | null;
    overlayText?: string | null;
  };
  const {
    avatarId,
    jobId,
    language,
    aspectRatio,
    originalScript,
    durationSeconds,
    videoUrl,
    wardrobePresetId,
    backgroundPresetId,
    overlayText,
  } = body;

  if (!avatarId || !jobId || !language || !aspectRatio || !videoUrl) {
    return NextResponse.json({ error: "Missing finalize parameters." }, { status: 400 });
  }

  // Ownership check.
  const { data: avatar } = await ctx.supabase
    .from("avatars")
    .select("id")
    .eq("id", avatarId)
    .eq("account_id", ctx.accountId)
    .single();
  if (!avatar) {
    return NextResponse.json({ error: "Avatar not found." }, { status: 404 });
  }

  try {
    // 1. Download the finished video from the generation provider.
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Could not download generated video (${res.status}).`);
    let bytes: Uint8Array = Buffer.from(await res.arrayBuffer());

    // 2. Burn the mandatory "Generated with AI" disclosure mark (every video)
    //    plus the optional on-screen caption, in one ffmpeg pass. The
    //    disclosure is a legal requirement, so a failure here fails the
    //    generation rather than shipping an unmarked video (no charge — the
    //    debit happens only after a successful insert below).
    const caption = (overlayText ?? "").trim();
    bytes = await burnVideoMarks(bytes, { caption, aspectRatio });

    // 3. Store it privately.
    const path = `${ctx.accountId}/${avatarId}/${jobId}/video_${language}.mp4`;
    const { error: upErr } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (upErr) throw new Error(upErr.message);

    // 3. Record the video row (output_url stores the storage path; signed URLs
    //    are generated on demand for playback since they expire).
    const { data: video, error: insErr } = await ctx.supabase
      .from("videos")
      .insert({
        avatar_id: avatarId,
        script: originalScript ?? null,
        language,
        aspect_ratio: aspectRatio,
        wardrobe_preset_id: wardrobePresetId ?? null,
        background_preset_id: backgroundPresetId ?? null,
        overlay_text: caption || null,
        status: "ready",
        duration_seconds: durationSeconds ?? null,
        output_url: path,
      })
      .select("id")
      .single();
    if (insErr || !video) throw new Error(insErr?.message ?? "Could not save the video.");

    // 4. Debit credits for this completed video (server-side, exactly once).
    //    A failed generation never reaches here, so it is never charged.
    let secondsCharged = 0;
    try {
      const admin = createAdminClient();
      const charge = secondsToCharge(durationSeconds);
      const result = await debitForVideo(admin, ctx.accountId, video.id, charge);
      secondsCharged = result.secondsCharged;
    } catch (e) {
      // Don't fail the whole generation if the debit hiccups — log loudly.
      console.error(`[credits] debit failed for video ${video.id}: ${String(e)}`);
    }

    // 5. Return a signed URL for immediate playback/download.
    const { data: signed } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .createSignedUrl(path, 3600);

    return NextResponse.json({
      videoId: video.id,
      videoPath: path,
      videoUrl: signed?.signedUrl ?? null,
      secondsCharged,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not finalize the video.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
