// Centralised, validated access to the public Supabase env vars.
// Throwing here gives a clear build/runtime error instead of an opaque
// "fetch failed" from the Supabase client when a var is missing.

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY (locally in .env.local, and in " +
        "Vercel → Project Settings → Environment Variables)."
    );
  }

  return { url, anonKey };
}
