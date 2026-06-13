import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { REFERENCE_PHOTOS_BUCKET } from "@/lib/avatars";
import { VideoModelUnavailableError, submitInfiniteTalk } from "@/lib/wavespeed";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBalanceSeconds, secondsToCharge } from "@/lib/credits";
import { checkRateLimit } from "@/lib/rateLimit";
import { logApiUsage } from "@/lib/usageLog";
import { inspectFace, faceRejectionMessage } from "@/lib/face-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { avatarId, audioUrl, imageUrl, durationSeconds } = (await request
    .json()
    .catch(() => ({}))) as {
    avatarId?: string;
    audioUrl?: string;
    imageUrl?: string;
    durationSeconds?: number;
  };
  if (!avatarId || !audioUrl) {
    return NextResponse.json({ error: "Missing video parameters." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Rate limit: protects against runaway cost loops, not normal use.
  // Eolax is a company account (multiple people / multi-language batches), so the
  // window allowance is generous; the per-minute cap is the real runaway guard.
  const rl = await checkRateLimit(admin, ctx.accountId, "video/start", {
    perMinute: 10,
    perLongWindow: { count: 30, windowMinutes: 20 },
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demasiadas generaciones de video. Intenta en unos minutos." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  // Server-side balance pre-check BEFORE calling the expensive API.
  const estimatedSeconds = secondsToCharge(durationSeconds);
  const balance = await getBalanceSeconds(admin, ctx.accountId);
  if (balance < estimatedSeconds) {
    return NextResponse.json(
      {
        error: `Créditos insuficientes: necesitás ~${estimatedSeconds}s y tenés ${balance}s.`,
      },
      { status: 402 }
    );
  }

  const { data: avatar } = await ctx.supabase
    .from("avatars")
    .select("status, reference_photos, elevenlabs_voice_id")
    .eq("id", avatarId)
    .eq("account_id", ctx.accountId)
    .single();

  if (!avatar || avatar.status !== "active" || !avatar.elevenlabs_voice_id) {
    return NextResponse.json(
      { error: "Avatar must be active with a cloned voice." },
      { status: 400 }
    );
  }

  let faceImageUrl = imageUrl;
  if (!faceImageUrl) {
    const firstPhoto = avatar.reference_photos?.[0];
    if (!firstPhoto) {
      return NextResponse.json(
        { error: "Avatar has no reference photo to drive the video." },
        { status: 400 }
      );
    }
    const { data: signed } = await ctx.supabase.storage
      .from(REFERENCE_PHOTOS_BUCKET)
      .createSignedUrl(firstPhoto, 3600);
    if (!signed?.signedUrl) {
      return NextResponse.json({ error: "Could not read the reference photo." }, { status: 500 });
    }
    faceImageUrl = signed.signedUrl;
  }

  // --- FINAL-FRAME GUARD ------------------------------------------------------
  const faceCheck = await inspectFace(faceImageUrl);
  if (!faceCheck.ok) {
    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "openrouter",
      route: "video/start:face-guard",
      costUsdEst: 0.001,
      status: "error",
      errorMsg: `blocked: faces=${faceCheck.faceCount} collage=${faceCheck.isCollage}`,
    });
    return NextResponse.json(
      { error: faceRejectionMessage(faceCheck) },
      { status: 422 }
    );
  }
  // --- END FINAL-FRAME GUARD --------------------------------------------------

  try {
    const predictionId = await submitInfiniteTalk({
      imageUrl: faceImageUrl,
      audioUrl,
    });

    const costEst = (durationSeconds ?? 10) * 0.06;
    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "wavespeed",
      route: "video/start",
      costUsdEst: Math.round(costEst * 10000) / 10000,
      status: "ok",
    });

    return NextResponse.json({ predictionId, status: "processing" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not start video generation.";

    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "wavespeed",
      route: "video/start",
      costUsdEst: 0,
      status: "error",
      errorMsg: message.slice(0, 500),
    });

    if (e instanceof VideoModelUnavailableError) {
      return NextResponse.json(
        { error: "Video model unavailable. Please try again later." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
