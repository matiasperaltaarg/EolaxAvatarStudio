import { createClient } from "@/lib/supabase/server";

// Per-user account resolution. Each user's account is stored in
// profiles.account_id. Falls back to the oldest account (legacy single-account
// behaviour) if the user has no account assigned yet — so existing sessions
// never break during the transition.
export async function getAccountId(): Promise<string> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 1. Preferred: the account linked to this user's profile.
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("id", user.id)
      .single();
    if (profile?.account_id) return profile.account_id as string;
  }

  // 2. Fallback: oldest account (legacy). Keeps the app working for any user
  //    not yet assigned to an account.
  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error("No account found for this user.");
  }
  return data.id;
}
