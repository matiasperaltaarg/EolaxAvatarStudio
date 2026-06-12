import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { GENERATED_CONTENT_BUCKET } from "@/lib/avatars";
import { createAdminClient } from "@/lib/supabase/admin";
import { atomicDebitForVideo, secondsToCharge } from "@/lib/credits";
import { logApiUsage } from "@/lib/usageLog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  } = body;

  if (!avatarId || !jobId || !language || !aspectRatio || !videoUrl) {
    return NextResponse.json({ error: "Missing finalize parameters." }, { status: 400 });
  }

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
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Could not download generated video (${res.status}).`);
    const bytes: Uint8Array = Buffer.from(await res.arrayBuffer());

    const path = `${ctx.accountId}/${avatarId}/${jobId}/video_${language}.mp4`;
    const { error: upErr } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { data: video, error: insErr } = await ctx.supabase
      .from("videos")
      .insert({
        avatar_id: avatarId,
        script: originalScript ?? null,
        language,
        aspect_ratio: aspectRatio,
        wardrobe_preset_id: wardrobePresetId ?? null,
        background_preset_id: backgroundPresetId ?? null,
        overlay_text: null,
        status: "ready",
        duration_seconds: durationSeconds ?? null,
        output_url: path,
      })
      .select("id")
      .single();
    if (insErr || !video) throw new Error(insErr?.message ?? "Could not save the video.");

    // Atomic debit: checks balance + claims + debits in one Postgres transaction.
    let secondsCharged = 0;
    const admin = createAdminClient();
    try {
      const charge = secondsToCharge(durationSeconds);
      const result = await atomicDebitForVideo(admin, ctx.accountId, video.id, charge);
      secondsCharged = result.secondsCharged;
      if (!result.charged) {
        console.warn(
          `[credits] atomic debit returned charged=false for video ${video.id} ` +
            `(account ${ctx.accountId}, ${charge}s). Video saved but not charged.`
        );
      }
    } catch (e) {
      console.error(`[credits] atomic debit failed for video ${video.id}: ${String(e)}`);
    }

    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "internal",
      route: "finalize",
      costUsdEst: 0,
      status: "ok",
    });

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
