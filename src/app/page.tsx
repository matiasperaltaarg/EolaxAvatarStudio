import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

// Reads auth cookies — must be rendered per request, never prerendered.
export const dynamic = "force-dynamic";

// Protected home. The middleware already redirects unauthenticated users
// to /login; we re-check here as a defence-in-depth measure and to read
// the user for display.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="container">
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Eolax Avatar Studio</h1>
        <p className="muted">Phase 0 skeleton — you are signed in.</p>
        <p className="muted">
          Signed in as <strong>{user.email}</strong>
        </p>
        <form action={signOut}>
          <button className="secondary" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
