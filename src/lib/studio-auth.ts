import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";

// Shared auth/context for the studio API routes. Returns the server Supabase
// client and the Eolax account id, or null when the request is unauthenticated.
export async function authedContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const accountId = await getAccountId();
  return { supabase, accountId, userId: user.id };
}
