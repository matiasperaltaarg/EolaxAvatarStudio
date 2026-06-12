import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { GENERATED_CONTENT_BUCKET, studioLanguage, studioAccentTag } from "@/lib/avatars";
import { textToSpeechWithDuration, ELEVENLABS_MODEL_ID } from "@/lib/elevenlabs";
import { enrichForNaturalSpeech } from "@/lib/openrouter";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { logApiUsage } from "@/lib/usageLog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { avatarId, jobId, language, text, accent } = (await request.json().catch(() => ({}))) as {
    avatarId?: string;
    jobId?: string;
    language?: string;
    text?: string;
    accent?: string;
  };
  if (!avatarId || !jobId || !language || !text?.trim()) {
    return NextResponse.json({ error: "Missing voice generation parameters." }, { status: 400 });
  }

  const admin = createAdminClient();

  const rl = await checkRateLimit(admin, ctx.accountId, "voice", { perMinute: 20 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes de voz. Intenta en un minuto." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const { data: avatar } = await ctx.supabase
    .from("avatars")
    .select("status, elevenlabs_voice_id")
    .eq("id", avatarId)
    .eq("account_id", ctx.accountId)
    .single();

  if (!avatar?.elevenlabs_voice_id || avatar.status !== "active") {
    return NextResponse.json(
      { error: "Avatar must be active and have a cloned voice." },
      { status: 400 }
    );
  }

  try {
    let speechText = text;
    if (ELEVENLABS_MODEL_ID.includes("_v3")) {
      const englishName = studioLanguage(language)?.english ?? "Spanish";
      const accentTag = language.toLowerCase().startsWith("es")
        ? studioAccentTag(accent)
        : "";
      try {
        speechText = await enrichForNaturalSpeech(text, englishName, accentTag || undefined);
      } catch {
        speechText = text;
      }
    }

    const { audio, durationSeconds } = await textToSpeechWithDuration(
      avatar.elevenlabs_voice_id,
      speechText,
      language
    );
    const path = `${ctx.accountId}/${avatarId}/${jobId}/audio_${language}.mp3`;

    const { error: upErr } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { data: signed } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .createSignedUrl(path, 3600);

    const charCount = text.length;
    const costEst = (charCount / 1_000_000) * 0.3;
    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "elevenlabs",
      route: "voice",
      costUsdEst: Math.round(costEst * 10000) / 10000,
      status: "ok",
    });

    return NextResponse.json({
      audioPath: path,
      audioUrl: signed?.signedUrl ?? null,
      durationSeconds,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Voice generation failed.";

    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "elevenlabs",
      route: "voice",
      costUsdEst: 0,
      status: "error",
      errorMsg: message.slice(0, 500),
    });

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
