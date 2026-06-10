import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { REFERENCE_PHOTOS_BUCKET } from "@/lib/avatars";
import { VideoModelUnavailableError, submitInfiniteTalk } from "@/lib/wavespeed";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/studio/video/start  { avatarId, audioUrl }
// Submits a WaveSpeedAI InfiniteTalk task from the avatar's first reference
// photo + the generated audio. Returns the prediction id for client polling.
// InfiniteTalk renders the full audio length — no per-clip frame cap.
export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { avatarId, audioUrl, imageUrl } = (await request.json().catch(() => ({}))) as {
    avatarId?: string;
    audioUrl?: string;
    imageUrl?: string;
  };
  if (!avatarId || !audioUrl) {
    return NextResponse.json({ error: "Missing video parameters." }, { status: 400 });
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
  // Use the edited look image when provided; otherwise the raw reference photo.
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

  try {
    const predictionId = await submitInfiniteTalk({
      imageUrl: faceImageUrl,
      audioUrl,
    });
    return NextResponse.json({ predictionId, status: "processing" });
  } catch (e) {
    if (e instanceof VideoModelUnavailableError) {
      return NextResponse.json(
        { error: "Video model unavailable. Please try again later." },
        { status: 503 }
      );
    }
    const message = e instanceof Error ? e.message : "Could not start video generation.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
