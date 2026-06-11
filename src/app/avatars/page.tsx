import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { languageLabel, type Avatar } from "@/lib/avatars";
import { getAvatarCreditBalance } from "@/lib/credits";
import AppShell from "@/app/AppShell";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { active: "activo", draft: "borrador" };

export default async function AvatarsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const accountId = await getAccountId();
  const avatarCredits = await getAvatarCreditBalance(supabase, accountId);
  const { data: avatars } = await supabase
    .from("avatars")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });

  const list = (avatars ?? []) as Avatar[];

  return (
    <AppShell>
    <main className="container wide">
      <header className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Avatares</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Personajes exclusivos de marca para la cuenta de Eolax.
            Créditos de avatar disponibles: <strong>{avatarCredits}</strong>.
          </p>
        </div>
        <Link href="/avatars/new">
          <button type="button">+ Nuevo avatar</button>
        </Link>
      </header>

      {list.length === 0 ? (
        <div className="card empty">
          <p style={{ marginTop: 0 }}>Aún no hay avatares.</p>
          <p className="muted">
            Crea tu primer avatar — empieza como borrador hasta confirmar los
            derechos de imagen y voz firmados.
          </p>
          <Link href="/avatars/new">
            <button type="button">+ Crear avatar</button>
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
                    {a.reference_photos?.length ?? 0}{" "}
                    {(a.reference_photos?.length ?? 0) === 1 ? "foto" : "fotos"}
                  </div>
                </div>
                <div className="row">
                  <span className={`badge rights-${a.rights_confirmed}`}>
                    {a.rights_confirmed ? "Derechos ✓" : "Derechos pendientes"}
                  </span>
                  <span className={`badge status-${a.status}`}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
    </AppShell>
  );
}
