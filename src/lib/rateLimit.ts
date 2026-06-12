import type { SupabaseClient } from "@supabase/supabase-js";

type Allowed = { allowed: true };
type Blocked = { allowed: false; retryAfterSeconds: number };
type RateLimitResult = Allowed | Blocked;

export async function checkRateLimit(
  admin: SupabaseClient,
  accountId: string,
  route: string,
  limits: {
    perMinute: number;
    perLongWindow?: { count: number; windowMinutes: number };
  }
): Promise<RateLimitResult> {
  const now = Date.now();

  const oneMinAgo = new Date(now - 60_000).toISOString();
  const { count: perMinCount } = await admin
    .from("rate_events")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("route", route)
    .gte("created_at", oneMinAgo);

  if ((perMinCount ?? 0) >= limits.perMinute) {
    return { allowed: false, retryAfterSeconds: 60 };
  }

  if (limits.perLongWindow) {
    const windowStart = new Date(
      now - limits.perLongWindow.windowMinutes * 60_000
    ).toISOString();
    const { count: windowCount } = await admin
      .from("rate_events")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("route", route)
      .gte("created_at", windowStart);

    if ((windowCount ?? 0) >= limits.perLongWindow.count) {
      return {
        allowed: false,
        retryAfterSeconds: limits.perLongWindow.windowMinutes * 60,
      };
    }
  }

  await admin
    .from("rate_events")
    .insert({ account_id: accountId, route });

  return { allowed: true };
}
