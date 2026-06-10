import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signIn } from "./actions";

// Reads auth cookies — must be rendered per request, never prerendered.
export const dynamic = "force-dynamic";

// Public login page. If already authenticated, skip straight to home.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  const { error } = await searchParams;

  return (
    <main className="container">
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Eolax Avatar Studio</h1>
        <p className="muted">Sign in to continue.</p>

        {error ? <p className="error">{error}</p> : null}

        <form action={signIn}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />

          <button type="submit">Sign in</button>
        </form>
      </div>
    </main>
  );
}
