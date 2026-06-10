import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

// Service-role Supabase client for trusted server-side writes (e.g. credit
// debits) that must not depend on the user's session / RLS. NEVER import this
// from a Client Component. The service role key bypasses RLS.
export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Set it server-side (Vercel → Project " +
        "Settings → Environment Variables). Required for credit debits."
    );
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
