import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { textToSpeech } from "@/lib/elevenlabs";

// POST /api/avatars/[id]/voice/preview  { text }
// Returns MP3 audio for the avatar's cloned voice. Preview only — no credits.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const accountId = await getAccountId();
  const { data: avatar } = await supabase
    .from("avatars")
    .select("elevenlabs_voice_id")
    .eq("id", id)
    .eq("account_id", accountId)
    .single();

  if (!avatar?.elevenlabs_voice_id) {
    return NextResponse.json(
      { error: "This avatar has no cloned voice yet." },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Enter some text to preview." }, { status: 400 });
  }

  try {
    const audio = await textToSpeech(avatar.elevenlabs_voice_id, text);
    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Voice preview failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
