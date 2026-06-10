import { createClient } from "@/lib/supabase/server";

// Single-account MVP: there is exactly one seeded `Eolax` account. This
// returns its id. Modelled this way so multi-user is additive later
// (swap this for a per-user lookup) rather than a rewrite.
export async function getAccountId(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(
      "No account found. Run the Phase 0 migration which seeds the Eolax account."
    );
  }

  return data.id;
}
