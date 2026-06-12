import type { SupabaseClient } from "@supabase/supabase-js";

// Credit packs are measured in SECONDS of generated video. 6-month expiry.
export const PACKS: Record<string, { label: string; seconds: number }> = {
  starter: { label: "Starter", seconds: 600 }, // 10 min
  pro: { label: "Pro", seconds: 1800 }, // 30 min
  scale: { label: "Scale", seconds: 3600 }, // 60 min
};

export type CreditPack = {
  id: string;
  account_id: string;
  pack_type: string;
  seconds_total: number;
  seconds_used: number;
  purchased_at: string;
  expires_at: string;
};

// Available balance = sum over NON-EXPIRED packs of (seconds_total - seconds_used).
export async function getBalanceSeconds(
  supabase: SupabaseClient,
  accountId: string
): Promise<number> {
  const { data } = await supabase
    .from("credit_packs")
    .select("seconds_total, seconds_used, expires_at")
    .eq("account_id", accountId)
    .gt("expires_at", new Date().toISOString());

  return (data ?? []).reduce(
    (sum, p) => sum + Math.max(0, (p.seconds_total ?? 0) - (p.seconds_used ?? 0)),
    0
  );
}

// Number of seconds to charge for a video of the given duration. Round up so we
// never undercharge; minimum 1 second.
export function secondsToCharge(durationSeconds: number | null | undefined): number {
  return Math.max(1, Math.ceil(durationSeconds ?? 0));
}

// Debit `seconds` for a completed video, oldest non-expired pack first, and log
// it. Idempotent per video: generations_log.video_id is unique, so a duplicate
// finalize/re-poll will not double-charge.
//
// Pass a SERVICE-ROLE client so this never depends on the user's RLS.
export async function debitForVideo(
  admin: SupabaseClient,
  accountId: string,
  videoId: string,
  seconds: number
): Promise<{ charged: boolean; secondsCharged: number }> {
  // Guard: claim the charge by inserting the log row first. If it already
  // exists (unique violation / ignored duplicate), this video was charged.
  const { data: claimed, error: claimErr } = await admin
    .from("generations_log")
    .upsert(
      { video_id: videoId, seconds_charged: seconds },
      { onConflict: "video_id", ignoreDuplicates: true }
    )
    .select("id");

  if (claimErr) throw new Error(`Credit log failed: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) {
    // Already charged for this video.
    return { charged: false, secondsCharged: 0 };
  }

  // Spread the charge across non-expired packs, oldest first.
  const { data: packs } = await admin
    .from("credit_packs")
    .select("id, seconds_total, seconds_used, expires_at")
    .eq("account_id", accountId)
    .gt("expires_at", new Date().toISOString())
    .order("purchased_at", { ascending: true });

  let remaining = seconds;
  for (const pack of packs ?? []) {
    if (remaining <= 0) break;
    const available = Math.max(0, pack.seconds_total - pack.seconds_used);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    const { error } = await admin
      .from("credit_packs")
      .update({ seconds_used: pack.seconds_used + take })
      .eq("id", pack.id);
    if (error) throw new Error(`Credit debit failed: ${error.message}`);
    remaining -= take;
  }

  // If remaining > 0 the account was overdrawn (balance under-checked); the log
  // still records the full charge. Not expected given the pre-check.
  return { charged: true, secondsCharged: seconds };
}

// Atomic video credit debit via Postgres function (migration 0010).
// Checks balance + claims log + debits FIFO in a single transaction.
// If insufficient balance, returns charged=false WITHOUT inserting a log row.
export async function atomicDebitForVideo(
  admin: SupabaseClient,
  accountId: string,
  videoId: string,
  seconds: number
): Promise<{ charged: boolean; secondsCharged: number }> {
  const { data, error } = await admin.rpc("debit_video_seconds", {
    p_account_id: accountId,
    p_video_id: videoId,
    p_seconds: seconds,
  });

  if (error) {
    console.error(`[credits] atomic debit RPC failed: ${error.message}`);
    throw new Error(`Atomic debit failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    charged: row?.charged ?? false,
    secondsCharged: row?.seconds_charged ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Avatar credits — second currency
// ---------------------------------------------------------------------------

export type AvatarCreditPack = {
  id: string;
  account_id: string;
  credits_total: number;
  credits_used: number;
  purchased_at: string;
  expires_at: string;
};

export async function getAvatarCreditBalance(
  supabase: SupabaseClient,
  accountId: string
): Promise<number> {
  const { data } = await supabase
    .from("avatar_credit_packs")
    .select("credits_total, credits_used, expires_at")
    .eq("account_id", accountId)
    .gt("expires_at", new Date().toISOString());

  return (data ?? []).reduce(
    (sum, p) => sum + Math.max(0, (p.credits_total ?? 0) - (p.credits_used ?? 0)),
    0
  );
}

export async function debitForAvatarCreation(
  admin: SupabaseClient,
  accountId: string,
  avatarId: string
): Promise<{ charged: boolean }> {
  const { data: claimed, error: claimErr } = await admin
    .from("avatar_creation_log")
    .upsert(
      { avatar_id: avatarId, credits_charged: 1 },
      { onConflict: "avatar_id", ignoreDuplicates: true }
    )
    .select("id");

  if (claimErr) throw new Error(`Avatar credit log failed: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) {
    return { charged: false };
  }

  const { data: packs } = await admin
    .from("avatar_credit_packs")
    .select("id, credits_total, credits_used, expires_at")
    .eq("account_id", accountId)
    .gt("expires_at", new Date().toISOString())
    .order("purchased_at", { ascending: true });

  for (const pack of packs ?? []) {
    const available = Math.max(0, pack.credits_total - pack.credits_used);
    if (available <= 0) continue;
    const { error } = await admin
      .from("avatar_credit_packs")
      .update({ credits_used: pack.credits_used + 1 })
      .eq("id", pack.id);
    if (error) throw new Error(`Avatar credit debit failed: ${error.message}`);
    return { charged: true };
  }

  return { charged: true };
}
