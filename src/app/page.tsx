import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { getBalanceSeconds } from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";
import AppShell from "@/app/AppShell";

export const dynamic = "force-dynamic";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}m ${s}s`;
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const accountId = await getAccountId();
  const admin = createAdminClient();

  // All stats are REAL — counted from the database. No placeholder metrics.
  const [videoSeconds, avatarsRes, videosRes] = await Promise.all([
    getBalanceSeconds(supabase, accountId),
    admin
      .from("avatars")
      .select("id, status", { count: "exact" })
      .eq("account_id", accountId),
    admin
      .from("videos")
      .select("id, duration_seconds, status, avatar_id")
      .eq("status", "ready"),
  ]);

  const avatars = avatarsRes.data ?? [];
  const activeAvatars = avatars.filter((a) => a.status === "active").length;
  const avatarIds = new Set(avatars.map((a) => a.id));

  // videos has no account_id; scope by this account's avatars.
  const videos = (videosRes.data ?? []).filter((v) => avatarIds.has(v.avatar_id));
  const videoCount = videos.length;
  const totalVideoSeconds = videos.reduce(
    (sum, v) => sum + (Number(v.duration_seconds) || 0),
    0
  );

  return (
    <AppShell>
      <main className="container wide">
        <header className="page-header">
          <div>
            <h1>Panel</h1>
            <p className="muted">Estado de tu cuenta Eolax en tiempo real.</p>
          </div>
        </header>

        <section className="stat-grid">
          <div className="stat-card">
            <span className="stat-label">Tiempo de video disponible</span>
            <span className="stat-value">{mmss(videoSeconds)}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Avatares activos</span>
            <span className="stat-value">{activeAvatars}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Videos generados</span>
            <span className="stat-value">{videoCount}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Minutos producidos</span>
            <span className="stat-value">{mmss(totalVideoSeconds)}</span>
          </div>
        </section>

        <section className="card">
          <h2>Acciones rápidas</h2>
          <div className="quick-actions">
            <Link href="/studio"><button type="button">Crear video</button></Link>
            <Link href="/avatars"><button type="button" className="secondary">Mis avatares</button></Link>
            <Link href="/gallery"><button type="button" className="secondary">Galería</button></Link>
            <Link href="/credits"><button type="button" className="secondary">Saldo y packs</button></Link>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
