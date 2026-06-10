import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { signOut } from "@/app/login/actions";
import { languageLabel, type Avatar } from "@/lib/avatars";

export const dynamic = "force-dynamic";

export default async function AvatarsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const accountId = await getAccountId();
  const { data: avatars } = await supabase
    .from("avatars")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });

  const list = (avatars ?? []) as Avatar[];

  return (
    <main className="container wide">
      <header className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Avatars</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Brand-exclusive characters for the Eolax account.
          </p>
        </div>
        <div className="row">
          <Link href="/avatars/new">
            <button type="button">+ New avatar</button>
          </Link>
          <form action={signOut}>
            <button className="secondary" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {list.length === 0 ? (
        <div className="card empty">
          <p style={{ marginTop: 0 }}>No avatars yet.</p>
          <p className="muted">
            Create your first avatar — it starts as a draft until signed image
            and voice rights are confirmed.
          </p>
          <Link href="/avatars/new">
            <button type="button">+ Create avatar</button>
          </Link>
        </div>
      ) : (
        <ul className="avatar-list">
          {list.map((a) => (
            <li key={a.id}>
              <Link href={`/avatars/${a.id}`} className="avatar-row">
                <div>
                  <div className="avatar-name">{a.name}</div>
                  <div className="muted small">
                    {languageLabel(a.default_language)} ·{" "}
                    {a.reference_photos?.length ?? 0} photo
                    {(a.reference_photos?.length ?? 0) === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="row">
                  <span className={`badge rights-${a.rights_confirmed}`}>
                    {a.rights_confirmed ? "Rights ✓" : "Rights pending"}
                  </span>
                  <span className={`badge status-${a.status}`}>{a.status}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
