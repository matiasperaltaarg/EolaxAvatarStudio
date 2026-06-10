import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { GENERATED_CONTENT_BUCKET } from "@/lib/avatars";
import { textToSpeechWithDuration } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/studio/voice  { avatarId, jobId, language, text }
// Generates TTS with the avatar's cloned voice, stores the mp3 privately and
// returns a signed URL plus an estimated duration.
export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { avatarId, jobId, language, text } = (await request.json().catch(() => ({}))) as {
    avatarId?: string;
    jobId?: string;
    language?: string;
    text?: string;
  };
  if (!avatarId || !jobId || !language || !text?.trim()) {
    return NextResponse.json({ error: "Missing voice generation parameters." }, { status: 400 });
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
    // Actual audio duration (from ElevenLabs character alignment) — used for
    // the videos.duration_seconds column.
    const { audio, durationSeconds } = await textToSpeechWithDuration(
      avatar.elevenlabs_voice_id,
      text
    );
    const path = `${ctx.accountId}/${avatarId}/${jobId}/audio_${language}.mp3`;

    const { error: upErr } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { data: signed } = await ctx.supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .createSignedUrl(path, 3600);

    return NextResponse.json({
      audioPath: path,
      audioUrl: signed?.signedUrl ?? null,
      durationSeconds,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Voice generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
