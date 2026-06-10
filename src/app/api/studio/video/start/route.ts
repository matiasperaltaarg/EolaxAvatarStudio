import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { REFERENCE_PHOTOS_BUCKET } from "@/lib/avatars";
import { VideoModelUnavailableError, startLipsyncVideo } from "@/lib/replicate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/studio/video/start  { avatarId, audioUrl }
// Starts a MultiTalk lip-sync prediction from the avatar's first reference
// photo + the generated audio. Returns the prediction id for client polling.
//
// Note: the model renders at its native ratio and center-crops the image;
// true 9:16 / 1:1 / 16:9 cropping is a Phase 6 polish item. The chosen
// aspect_ratio is still recorded on the video row.
export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { avatarId, audioUrl } = (await request.json().catch(() => ({}))) as {
    avatarId?: string;
    audioUrl?: string;
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

  try {
    const prediction = await startLipsyncVideo({
      imageUrl: signed.signedUrl,
      audioUrl,
    });
    return NextResponse.json({ predictionId: prediction.id, status: prediction.status });
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
