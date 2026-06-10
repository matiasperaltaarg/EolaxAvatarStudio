import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { VOICE_REFERENCES_BUCKET } from "@/lib/avatars";
import { addVoice, deleteVoice } from "@/lib/elevenlabs";

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// POST /api/avatars/[id]/voice/clone
// Uploads the reference audio to a private bucket and clones the voice via
// ElevenLabs. One voice per avatar: re-cloning deletes the previous voice.
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
    .select("id, name, rights_confirmed, elevenlabs_voice_id, voice_reference_paths")
    .eq("id", id)
    .eq("account_id", accountId)
    .single();

  if (!avatar) {
    return NextResponse.json({ error: "Avatar not found." }, { status: 404 });
  }

  // Rights gate: cannot clone a person's voice without confirmed rights.
  if (!avatar.rights_confirmed) {
    return NextResponse.json(
      {
        error:
          "Voice cloning is blocked: confirm signed image AND voice rights for this avatar first.",
      },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const files = form.getAll("audio").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "Upload at least one audio sample." },
      { status: 400 }
    );
  }

  // 1. Store the reference audio in the private bucket.
  const storedPaths: string[] = [];
  for (const file of files) {
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "mp3";
    const path = `${accountId}/${id}/${crypto.randomUUID()}.${ext || "mp3"}`;
    const { error: upErr } = await supabase.storage
      .from(VOICE_REFERENCES_BUCKET)
      .upload(path, file, {
        contentType: file.type || "audio/mpeg",
        upsert: false,
      });
    if (upErr) {
      return NextResponse.json(
        { error: `Failed to store audio: ${upErr.message}` },
        { status: 500 }
      );
    }
    storedPaths.push(path);
  }

  try {
    // 2. Re-clone: remove the previous ElevenLabs voice if one exists.
    if (avatar.elevenlabs_voice_id) {
      await deleteVoice(avatar.elevenlabs_voice_id);
    }

    // 3. Clone via ElevenLabs.
    const voiceName = `eolax_avatar_${id}_${sanitize(avatar.name)}`;
    const voiceId = await addVoice(voiceName, files);

    // 4. Persist the voice id + reference paths (replace old references).
    const oldPaths: string[] = avatar.voice_reference_paths ?? [];
    const { error: updateErr } = await supabase
      .from("avatars")
      .update({
        elevenlabs_voice_id: voiceId,
        voice_reference_paths: storedPaths,
      })
      .eq("id", id);

    if (updateErr) {
      throw new Error(updateErr.message);
    }

    // Best-effort cleanup of superseded reference audio.
    if (oldPaths.length > 0) {
      await supabase.storage.from(VOICE_REFERENCES_BUCKET).remove(oldPaths);
    }

    return NextResponse.json({ voice_id: voiceId });
  } catch (e) {
    // Roll back the just-uploaded audio so storage doesn't leak on failure.
    await supabase.storage.from(VOICE_REFERENCES_BUCKET).remove(storedPaths);
    const message = e instanceof Error ? e.message : "Voice cloning failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
