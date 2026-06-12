import type { SupabaseClient } from "@supabase/supabase-js";

export async function logApiUsage(
  admin: SupabaseClient,
  entry: {
    accountId: string;
    provider: string;
    route: string;
    costUsdEst?: number;
    status: "ok" | "error";
    errorMsg?: string;
  }
): Promise<void> {
  try {
    await admin.from("api_usage_log").insert({
      account_id: entry.accountId,
      provider: entry.provider,
      route: entry.route,
      cost_usd_est: entry.costUsdEst ?? 0,
      status: entry.status,
      error_msg: entry.errorMsg ?? null,
    });
  } catch (e) {
    console.error("[usage-log] insert failed:", e);
  }
}
