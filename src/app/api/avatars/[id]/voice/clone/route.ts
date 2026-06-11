import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { VOICE_REFERENCES_BUCKET } from "@/lib/avatars";
import { addVoice, deleteVoice } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// POST /api/avatars/[id]/voice/clone  { storagePaths: string[] }
// The browser uploads the reference audio DIRECTLY to Supabase Storage (so the
// large WAV never hits this route's body, which on Vercel is capped at ~4.5MB).
// This route then downloads those files server-side and clones via ElevenLabs.
// One voice per avatar: re-cloning deletes the previous voice.
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

  const { storagePaths } = (await request.json().catch(() => ({}))) as {
    storagePaths?: string[];
  };

  // Only accept paths inside this account+avatar prefix (no traversal/abuse).
  const prefix = `${accountId}/${id}/`;
  const paths = (storagePaths ?? []).filter(
    (p) => typeof p === "string" && p.startsWith(prefix)
  );
  if (paths.length === 0) {
    return NextResponse.json(
      { error: "No uploaded audio reference was provided." },
      { status: 400 }
    );
  }

  // 1. Download the uploaded reference audio from storage (server-side).
  const files: File[] = [];
  for (const path of paths) {
    const { data: blob, error: dlErr } = await supabase.storage
      .from(VOICE_REFERENCES_BUCKET)
      .download(path);
    if (dlErr || !blob) {
      return NextResponse.json(
        { error: `Could not read the uploaded audio: ${dlErr?.message ?? "missing"}` },
        { status: 400 }
      );
    }
    const name = path.split("/").pop() || "sample.wav";
    files.push(new File([blob], name, { type: blob.type || "audio/wav" }));
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
        voice_reference_paths: paths,
      })
      .eq("id", id);

    if (updateErr) {
      throw new Error(updateErr.message);
    }

    // Best-effort cleanup of superseded reference audio (not the new ones).
    const supersededPaths = oldPaths.filter((p) => !paths.includes(p));
    if (supersededPaths.length > 0) {
      await supabase.storage.from(VOICE_REFERENCES_BUCKET).remove(supersededPaths);
    }

    return NextResponse.json({ voice_id: voiceId });
  } catch (e) {
    // Roll back the just-uploaded audio so storage doesn't leak on failure.
    await supabase.storage.from(VOICE_REFERENCES_BUCKET).remove(paths);
    const message = e instanceof Error ? e.message : "Voice cloning failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
