"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { GENERATED_CONTENT_BUCKET } from "@/lib/avatars";
import { removeStorageObjects, storageCleanupClient } from "@/lib/storage";

// Delete one generated video: the stored MP4 plus its row.
//
// Deleting does NOT refund credits — the render was already paid for. The
// charge row in `generations_log` survives (migration 0016 detaches it from
// the video), so /credits keeps showing the consumption after the file is gone.
export async function deleteVideo(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/gallery");

  const accountId = await getAccountId();
  const supabase = await createClient();

  // Ownership check on top of RLS: the video must belong to an avatar of this
  // account.
  const { data: video } = await supabase
    .from("videos")
    .select("id, output_url, avatars!inner(account_id)")
    .eq("id", id)
    .eq("avatars.account_id", accountId)
    .single();

  if (!video) {
    redirect(`/gallery?error=${encodeURIComponent("Vídeo no encontrado.")}`);
  }

  // Storage cleanup first (best-effort) — an orphaned row is worse than an
  // orphaned file, and the row delete below is the source of truth for the UI.
  await removeStorageObjects(storageCleanupClient(supabase), GENERATED_CONTENT_BUCKET, [
    video.output_url,
  ]);

  const { error } = await supabase.from("videos").delete().eq("id", id);
  if (error) {
    redirect(`/gallery?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/gallery");
  redirect(`/gallery?ok=${encodeURIComponent("Vídeo eliminado.")}`);
}
