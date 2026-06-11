import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBalanceSeconds, getAvatarCreditBalance } from "@/lib/credits";
import AppShell from "@/app/AppShell";
import { grantAvatarCredits, grantVideoTime } from "./actions";
import AdminToast from "./AdminToast";

export const dynamic = "force-dynamic";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}m ${s}s`;
}

type Account = { id: string; name: string; created_at: string };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; account?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin())) redirect("/");

  const { error, ok, account: selectedAccountId } = await searchParams;

  const admin = createAdminClient();

  const { data: accountsData } = await admin
    .from("accounts")
    .select("id, name, created_at")
    .order("created_at", { ascending: true });
  const accounts = (accountsData ?? []) as Account[];

  const selected = selectedAccountId
    ? accounts.find((a) => a.id === selectedAccountId) ?? accounts[0]
    : accounts[0];

  let videoBalance = 0;
  let avatarBalance = 0;
  type PackRow = {
    id: string;
    pack_type: string;
    seconds_total: number;
    seconds_used: number;
    purchased_at: string;
    expires_at: string;
  };
  type AvatarPackRow = {
    id: string;
    credits_total: number;
    credits_used: number;
    purchased_at: string;
    expires_at: string;
  };
  let videoPacks: PackRow[] = [];
  let avatarPacks: AvatarPackRow[] = [];

  type AvatarLogRow = {
    credits_charged: number;
    created_at: string;
    avatars: { name: string } | null;
  };
  type VideoLogRow = {
    seconds_charged: number;
    created_at: string;
    videos: { language: string | null; avatars: { name: string } | null } | null;
  };
  let avatarLog: AvatarLogRow[] = [];
  let videoLog: VideoLogRow[] = [];

  if (selected) {
    const [vb, ab, vpRes, apRes, alRes, vlRes] = await Promise.all([
      getBalanceSeconds(admin, selected.id),
      getAvatarCreditBalance(admin, selected.id),
      admin
        .from("credit_packs")
        .select("id, pack_type, seconds_total, seconds_used, purchased_at, expires_at")
        .eq("account_id", selected.id)
        .order("purchased_at", { ascending: false }),
      admin
        .from("avatar_credit_packs")
        .select("id, credits_total, credits_used, purchased_at, expires_at")
        .eq("account_id", selected.id)
        .order("purchased_at", { ascending: false }),
      admin
        .from("avatar_creation_log")
        .select("credits_charged, created_at, avatars!inner(name, account_id)")
        .eq("avatars.account_id", selected.id)
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("generations_log")
        .select(
          "seconds_charged, created_at, videos!inner(language, avatars!inner(name, account_id))"
        )
        .eq("videos.avatars.account_id", selected.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    videoBalance = vb;
    avatarBalance = ab;
    videoPacks = (vpRes.data ?? []) as PackRow[];
    avatarPacks = (apRes.data ?? []) as AvatarPackRow[];
    avatarLog = (alRes.data ?? []) as unknown as AvatarLogRow[];
    videoLog = (vlRes.data ?? []) as unknown as VideoLogRow[];
  }

  const now = Date.now();

  return (
    <AppShell>
      <main className="container wide">
        <header className="page-header">
          <div>
            <h1 style={{ margin: 0 }}>Panel de administración</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Gestión de cuentas, créditos y saldos. Solo MTS.
            </p>
          </div>
        </header>

        <AdminToast ok={ok} error={error} />

        {/* Account selector */}
        <section className="card">
          <h2>Cuenta</h2>
          <form method="get" action="/admin">
            <label htmlFor="account">Seleccionar cuenta</label>
            <select id="account" name="account" defaultValue={selected?.id ?? ""}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.id.slice(0, 8)}…)
                </option>
              ))}
            </select>
            <button type="submit" className="secondary" style={{ marginTop: 8 }}>
              Ver cuenta
            </button>
          </form>
        </section>

        {selected ? (
          <>
            {/* Balances */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <section className="card balance-card">
                <div className="muted small" style={{ marginBottom: 4 }}>
                  Tiempo de video
                </div>
                <div className="balance-big">{mmss(videoBalance)}</div>
                <div className="muted">disponibles ({videoBalance}s)</div>
              </section>
              <section className="card balance-card">
                <div className="muted small" style={{ marginBottom: 4 }}>
                  Créditos de avatar
                </div>
                <div className="balance-big">{avatarBalance}</div>
                <div className="muted">
                  {avatarBalance === 1 ? "avatar disponible" : "avatares disponibles"}
                </div>
              </section>
            </div>

            {/* Grant avatar credits */}
            <section className="card">
              <h2>Cargar créditos de avatar</h2>
              <form action={grantAvatarCredits}>
                <input type="hidden" name="account_id" value={selected.id} />
                <label htmlFor="avatar_amount">Cantidad de créditos</label>
                <input
                  id="avatar_amount"
                  name="amount"
                  type="number"
                  min={1}
                  required
                  placeholder="ej. 5"
                />
                <button type="submit" style={{ marginTop: 8 }}>
                  Cargar créditos de avatar
                </button>
              </form>
            </section>

            {/* Grant video time */}
            <section className="card">
              <h2>Cargar tiempo de video</h2>
              <form action={grantVideoTime}>
                <input type="hidden" name="account_id" value={selected.id} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label htmlFor="video_minutes">Minutos</label>
                    <input
                      id="video_minutes"
                      name="minutes"
                      type="number"
                      min={0}
                      defaultValue={0}
                      placeholder="30"
                    />
                  </div>
                  <div>
                    <label htmlFor="video_seconds">Segundos</label>
                    <input
                      id="video_seconds"
                      name="seconds"
                      type="number"
                      min={0}
                      max={59}
                      defaultValue={0}
                      placeholder="0"
                    />
                  </div>
                </div>
                <button type="submit" style={{ marginTop: 8 }}>
                  Cargar tiempo de video
                </button>
              </form>
            </section>

            {/* Video packs */}
            <section className="card">
              <h2>Packs de video</h2>
              {videoPacks.length === 0 ? (
                <p className="muted">Sin packs de video.</p>
              ) : (
                <ul className="pack-list">
                  {videoPacks.map((p) => {
                    const expired = new Date(p.expires_at).getTime() < now;
                    const remaining = Math.max(0, p.seconds_total - p.seconds_used);
                    return (
                      <li key={p.id} className={`pack-row${expired ? " expired" : ""}`}>
                        <div>
                          <strong>{p.pack_type}</strong>
                          <span className="muted small">
                            {" "}· {remaining}s de {p.seconds_total}s
                          </span>
                        </div>
                        <div className="muted small">
                          {expired
                            ? `Caducó el ${new Date(p.expires_at).toLocaleDateString()}`
                            : `Caduca el ${new Date(p.expires_at).toLocaleDateString()}`}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Avatar packs */}
            <section className="card">
              <h2>Packs de avatar</h2>
              {avatarPacks.length === 0 ? (
                <p className="muted">Sin packs de avatar.</p>
              ) : (
                <ul className="pack-list">
                  {avatarPacks.map((p) => {
                    const expired = new Date(p.expires_at).getTime() < now;
                    const remaining = Math.max(0, p.credits_total - p.credits_used);
                    return (
                      <li key={p.id} className={`pack-row${expired ? " expired" : ""}`}>
                        <div>
                          <strong>Avatar pack</strong>
                          <span className="muted small">
                            {" "}· {remaining} de {p.credits_total}{" "}
                            {p.credits_total === 1 ? "crédito" : "créditos"}
                          </span>
                        </div>
                        <div className="muted small">
                          {expired
                            ? `Caducó el ${new Date(p.expires_at).toLocaleDateString()}`
                            : `Caduca el ${new Date(p.expires_at).toLocaleDateString()}`}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Consumption logs */}
            <section className="card">
              <h2>Consumo de avatares</h2>
              {avatarLog.length === 0 ? (
                <p className="muted">Sin consumo de avatares.</p>
              ) : (
                <ul className="pack-list">
                  {avatarLog.map((row, i) => (
                    <li key={i} className="pack-row">
                      <div>
                        <strong>{row.avatars?.name ?? "Avatar"}</strong>
                      </div>
                      <div className="muted small">
                        −{row.credits_charged} crédito ·{" "}
                        {new Date(row.created_at).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>Consumo de video</h2>
              {videoLog.length === 0 ? (
                <p className="muted">Sin consumo de video.</p>
              ) : (
                <ul className="pack-list">
                  {videoLog.map((row, i) => (
                    <li key={i} className="pack-row">
                      <div>
                        <strong>{row.videos?.avatars?.name ?? "Avatar"}</strong>
                        <span className="muted small">
                          {" "}· {row.videos?.language ?? "—"}
                        </span>
                      </div>
                      <div className="muted small">
                        −{Math.round(row.seconds_charged)}s ·{" "}
                        {new Date(row.created_at).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <p className="muted">No hay cuentas registradas.</p>
        )}
      </main>
    </AppShell>
  );
}
