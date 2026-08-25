"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import {
  GENERATED_CONTENT_BUCKET,
  REFERENCE_PHOTOS_BUCKET,
  VOICE_REFERENCES_BUCKET,
} from "@/lib/avatars";
import { deleteVoice as deleteElevenLabsVoice } from "@/lib/elevenlabs";
import {
  removeStorageFolder,
  removeStorageObjects,
  storageCleanupClient,
} from "@/lib/storage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  return ext ? `${crypto.randomUUID()}.${ext}` : crypto.randomUUID();
}

async function uploadReferencePhotos(
  accountId: string,
  avatarId: string,
  files: File[]
): Promise<string[]> {
  const supabase = await createClient();
  const paths: string[] = [];

  for (const file of files) {
    if (!file || file.size === 0) continue;
    const path = `${accountId}/${avatarId}/${sanitizeFileName(file.name)}`;
    const { error } = await supabase.storage
      .from(REFERENCE_PHOTOS_BUCKET)
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (error) {
      throw new Error(`Failed to upload "${file.name}": ${error.message}`);
    }
    paths.push(path);
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createAvatar(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const defaultLanguage = String(formData.get("default_language") ?? "es");
  const personality = String(formData.get("personality_editable") ?? "").trim();
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File);

  if (!name) {
    redirect(`/avatars/new?error=${encodeURIComponent("Avatar name is required.")}`);
  }

  const accountId = await getAccountId();
  const supabase = await createClient();

  // Create the draft row first so uploads can be namespaced by avatar id.
  const { data: avatar, error: insertError } = await supabase
    .from("avatars")
    .insert({
      account_id: accountId,
      name,
      default_language: defaultLanguage,
      personality_editable: personality || null,
      status: "draft",
      rights_confirmed: false,
    })
    .select("id")
    .single();

  if (insertError || !avatar) {
    redirect(
      `/avatars/new?error=${encodeURIComponent(insertError?.message ?? "Could not create avatar.")}`
    );
  }

  try {
    const paths = await uploadReferencePhotos(accountId, avatar.id, files);
    if (paths.length > 0) {
      await supabase.from("avatars").update({ reference_photos: paths }).eq("id", avatar.id);
    }
  } catch (e) {
    // Roll back the row so we never leave an avatar with a failed upload.
    await supabase.from("avatars").delete().eq("id", avatar.id);
    const message = e instanceof Error ? e.message : "Upload failed.";
    redirect(`/avatars/new?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/avatars");
  redirect(`/avatars/${avatar.id}`);
}

// ---------------------------------------------------------------------------
// Edit (allowed in any status)
// ---------------------------------------------------------------------------

export async function updateAvatar(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const defaultLanguage = String(formData.get("default_language") ?? "es");
  const personality = String(formData.get("personality_editable") ?? "").trim();

  if (!id) redirect("/avatars");

  const supabase = await createClient();
  const { error } = await supabase
    .from("avatars")
    .update({
      default_language: defaultLanguage,
      personality_editable: personality || null,
    })
    .eq("id", id);

  if (error) {
    redirect(`/avatars/${id}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/avatars/${id}`);
  redirect(`/avatars/${id}?ok=${encodeURIComponent("Avatar updated.")}`);
}

// ---------------------------------------------------------------------------
// Add more reference photos to an existing avatar
// ---------------------------------------------------------------------------

export async function addPhotos(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File);
  if (!id) redirect("/avatars");

  const accountId = await getAccountId();
  const supabase = await createClient();

  const { data: avatar } = await supabase
    .from("avatars")
    .select("reference_photos")
    .eq("id", id)
    .single();

  try {
    const newPaths = await uploadReferencePhotos(accountId, id, files);
    if (newPaths.length > 0) {
      const merged = [...(avatar?.reference_photos ?? []), ...newPaths];
      await supabase.from("avatars").update({ reference_photos: merged }).eq("id", id);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed.";
    redirect(`/avatars/${id}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/avatars/${id}`);
  redirect(`/avatars/${id}?ok=${encodeURIComponent("Photos added.")}`);
}

// Delete a single reference photo (lets Eolax swap an avatar's photo). An
// active avatar must keep at least one photo.
export async function deletePhoto(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const path = String(formData.get("path") ?? "");
  if (!id || !path) redirect("/avatars");

  const supabase = await createClient();
  const { data: avatar } = await supabase
    .from("avatars")
    .select("status, reference_photos")
    .eq("id", id)
    .single();

  const photos: string[] = avatar?.reference_photos ?? [];
  if (!photos.includes(path)) {
    redirect(`/avatars/${id}?error=${encodeURIComponent("Photo not found.")}`);
  }
  if (avatar?.status === "active" && photos.length <= 1) {
    redirect(
      `/avatars/${id}?error=${encodeURIComponent(
        "An active avatar must keep at least one reference photo. Set it to draft first."
      )}`
    );
  }

  await supabase.storage.from(REFERENCE_PHOTOS_BUCKET).remove([path]);
  await supabase
    .from("avatars")
    .update({ reference_photos: photos.filter((p) => p !== path) })
    .eq("id", id);

  revalidatePath(`/avatars/${id}`);
  redirect(`/avatars/${id}?ok=${encodeURIComponent("Photo deleted.")}`);
}

// ---------------------------------------------------------------------------
// Rights gate: confirm rights, activate, deactivate
// ---------------------------------------------------------------------------

export async function confirmRights(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const acknowledged = formData.get("acknowledge") === "on";
  if (!id) redirect("/avatars");

  if (!acknowledged) {
    redirect(
      `/avatars/${id}?error=${encodeURIComponent(
        "You must check the acknowledgement to confirm rights."
      )}`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("avatars")
    .update({ rights_confirmed: true })
    .eq("id", id);

  if (error) {
    redirect(`/avatars/${id}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/avatars/${id}`);
  redirect(`/avatars/${id}?ok=${encodeURIComponent("Rights confirmed on file.")}`);
}

export async function activateAvatar(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/avatars");

  const supabase = await createClient();

  // Server-side enforcement (defence in depth on top of the DB CHECK
  // constraint): refuse activation unless rights are confirmed.
  const { data: avatar } = await supabase
    .from("avatars")
    .select("rights_confirmed")
    .eq("id", id)
    .single();

  if (!avatar?.rights_confirmed) {
    redirect(
      `/avatars/${id}?error=${encodeURIComponent(
        "Cannot activate: signed image AND voice rights must be confirmed first."
      )}`
    );
  }

  const { error } = await supabase
    .from("avatars")
    .update({ status: "active" })
    .eq("id", id);

  if (error) {
    redirect(`/avatars/${id}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/avatars/${id}`);
  revalidatePath("/avatars");
  redirect(`/avatars/${id}?ok=${encodeURIComponent("Avatar activated.")}`);
}

export async function deactivateAvatar(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/avatars");

  const supabase = await createClient();
  const { error } = await supabase
    .from("avatars")
    .update({ status: "draft" })
    .eq("id", id);

  if (error) {
    redirect(`/avatars/${id}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/avatars/${id}`);
  revalidatePath("/avatars");
  redirect(`/avatars/${id}?ok=${encodeURIComponent("Avatar set back to draft.")}`);
}

// ---------------------------------------------------------------------------
// Delete the cloned voice (keeps the avatar)
// ---------------------------------------------------------------------------

// Removes the ElevenLabs voice and the reference audio it was cloned from. The
// avatar stays; a new voice can be cloned afterwards. Deleting the voice at
// ElevenLabs matters — cloned voices count against the account's voice slots.
export async function deleteClonedVoice(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/avatars");

  const accountId = await getAccountId();
  const supabase = await createClient();

  const { data: avatar } = await supabase
    .from("avatars")
    .select("id, elevenlabs_voice_id, voice_reference_paths")
    .eq("id", id)
    .eq("account_id", accountId)
    .single();

  if (!avatar) {
    redirect(`/avatars?error=${encodeURIComponent("Avatar no encontrado.")}`);
  }

  if (avatar.elevenlabs_voice_id) {
    try {
      await deleteElevenLabsVoice(avatar.elevenlabs_voice_id);
    } catch {
      // Best-effort: the voice may already be gone at ElevenLabs.
    }
  }

  await removeStorageObjects(
    storageCleanupClient(supabase),
    VOICE_REFERENCES_BUCKET,
    avatar.voice_reference_paths ?? []
  );

  const { error } = await supabase
    .from("avatars")
    .update({ elevenlabs_voice_id: null, voice_reference_paths: [] })
    .eq("id", id);

  if (error) {
    redirect(`/avatars/${id}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/avatars/${id}`);
  redirect(`/avatars/${id}?ok=${encodeURIComponent("Voz clonada eliminada.")}`);
}

// ---------------------------------------------------------------------------
// Delete the avatar
// ---------------------------------------------------------------------------

// Permanent. Deleting the row cascades to the avatar's videos, presets and look
// cache (see migration 0001), so this also clears everything it owns in Storage
// and the cloned voice at ElevenLabs.
//
// It does NOT refund credits: the videos were already rendered and paid for.
// The charge rows in `generations_log` survive the cascade (migration 0016), so
// /credits keeps matching the balance after the avatar is gone.
export async function deleteAvatar(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/avatars");

  const accountId = await getAccountId();
  const supabase = await createClient();

  // Ownership check on top of RLS.
  const { data: avatar } = await supabase
    .from("avatars")
    .select("id, name, reference_photos, voice_reference_paths, elevenlabs_voice_id")
    .eq("id", id)
    .eq("account_id", accountId)
    .single();

  if (!avatar) {
    redirect(`/avatars?error=${encodeURIComponent("Avatar no encontrado.")}`);
  }

  // Storage + ElevenLabs cleanup (all best-effort) before dropping the row —
  // once the row is gone we no longer know which files belonged to it.
  const storage = storageCleanupClient(supabase);
  const prefix = `${accountId}/${id}`;

  await Promise.all([
    // Whole folders, so files not tracked on the row (older uploads, renders
    // per job id) go too.
    removeStorageFolder(storage, REFERENCE_PHOTOS_BUCKET, prefix),
    removeStorageFolder(storage, VOICE_REFERENCES_BUCKET, prefix),
    removeStorageFolder(storage, GENERATED_CONTENT_BUCKET, prefix),
    // Plus anything recorded on the row outside that prefix (legacy paths).
    removeStorageObjects(storage, REFERENCE_PHOTOS_BUCKET, avatar.reference_photos ?? []),
    removeStorageObjects(storage, VOICE_REFERENCES_BUCKET, avatar.voice_reference_paths ?? []),
  ]);

  if (avatar.elevenlabs_voice_id) {
    try {
      await deleteElevenLabsVoice(avatar.elevenlabs_voice_id);
    } catch {
      // Best-effort: never block the delete on the voice provider.
    }
  }

  const { error } = await supabase
    .from("avatars")
    .delete()
    .eq("id", id)
    .eq("account_id", accountId);

  if (error) {
    redirect(`/avatars/${id}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/avatars");
  revalidatePath("/gallery");
  redirect(`/avatars?ok=${encodeURIComponent(`Avatar "${avatar.name}" eliminado.`)}`);
}
