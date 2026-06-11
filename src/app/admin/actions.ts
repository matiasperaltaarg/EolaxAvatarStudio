"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAdmin() {
  if (!(await isAdmin())) {
    redirect("/");
  }
}

export async function grantAvatarCredits(formData: FormData) {
  await requireAdmin();

  const accountId = String(formData.get("account_id") ?? "");
  const amount = parseInt(String(formData.get("amount") ?? "0"), 10);

  if (!accountId || amount < 1) {
    redirect(`/admin?error=${encodeURIComponent("Cuenta y cantidad son obligatorios.")}`);
  }

  const admin = createAdminClient();
  const { error } = await admin.from("avatar_credit_packs").insert({
    account_id: accountId,
    credits_total: amount,
    credits_used: 0,
    purchased_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
  redirect(`/admin?ok=${encodeURIComponent(`Se cargaron ${amount} créditos de avatar.`)}`);
}

export async function grantVideoTime(formData: FormData) {
  await requireAdmin();

  const accountId = String(formData.get("account_id") ?? "");
  const minutes = parseInt(String(formData.get("minutes") ?? "0"), 10);
  const seconds = parseInt(String(formData.get("seconds") ?? "0"), 10);
  const totalSeconds = minutes * 60 + seconds;

  if (!accountId || totalSeconds < 1) {
    redirect(`/admin?error=${encodeURIComponent("Cuenta y tiempo son obligatorios.")}`);
  }

  const admin = createAdminClient();
  const { error } = await admin.from("credit_packs").insert({
    account_id: accountId,
    pack_type: "admin_grant",
    seconds_total: totalSeconds,
    seconds_used: 0,
    purchased_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
  redirect(
    `/admin?ok=${encodeURIComponent(`Se cargaron ${minutes}m ${seconds}s de tiempo de video.`)}`
  );
}
