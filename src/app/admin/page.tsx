import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBalanceSeconds } from "@/lib/credits";
import AppShell from "@/app/AppShell";
import { grantVideoTime } from "./actions";
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

  // API usage log — global (not per-account), last 7 days.
  type UsageRow = {
    provider: string;
    cost_usd_est: number;
    status: string;
    created_at: string;
  };
  let usageRows: UsageRow[] = [];
  {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("api_usage_log")
      .select("provider, cost_usd_est, status, created_at")
      .gte("created_at", weekAgo)
      .order("created_at", { ascending: false })
      .limit(2000);
    usageRows = (data ?? []) as UsageRow[];
  }

  // Aggregate usage by provider and day.
  type DaySummary = { calls: number; errors: number; costUsd: number };
  const usageByProviderDay = new Map<string, Map<string, DaySummary>>();
  for (const row of usageRows) {
    const day = row.created_at.slice(0, 10);
    const prov = row.provider;
    if (!usageByProviderDay.has(prov)) usageByProviderDay.set(prov, new Map());
    const dayMap = usageByProviderDay.get(prov)!;
    if (!dayMap.has(day)) dayMap.set(day, { calls: 0, errors: 0, costUsd: 0 });
    const s = dayMap.get(day)!;
    s.calls++;
    if (row.status === "error") s.errors++;
    s.costUsd += Number(row.cost_usd_est) || 0;
  }
  const providers = [...usageByProviderDay.keys()].sort();
  const todayStr = new Date().toISOString().slice(0, 10);

  const { data: accountsData } = await admin
    .from("accounts")
    .select("id, name, created_at")
    .order("created_at", { ascending: true });
  const accounts = (accountsData ?? []) as Account[];

  const selected = selectedAccountId
    ? accounts.find((a) => a.id === selectedAccountId) ?? accounts[0]
    : accounts[0];

  let videoBalance = 0;
  type PackRow = {
    id: string;
    pack_type: string;
    seconds_total: number;
    seconds_used: number;
    purchased_at: string;
    expires_at: string;
  };
  let videoPacks: PackRow[] = [];

  type VideoLogRow = {
    seconds_charged: number;
    created_at: string;
    videos: { language: string | null; avatars: { name: string } | null } | null;
  };
  let videoLog: VideoLogRow[] = [];

  if (selected) {
    const [vb, vpRes, vlRes] = await Promise.all([
      getBalanceSeconds(admin, selected.id),
      admin
        .from("credit_packs")
        .select("id, pack_type, seconds_total, seconds_used, purchased_at, expires_at")
        .eq("account_id", selected.id)
        .order("purchased_at", { ascending: false }),
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
    videoPacks = (vpRes.data ?? []) as PackRow[];
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

        {/* API usage — global */}
        <section className="card">
          <h2>Gasto de APIs (últimos 7 días)</h2>
          {providers.length === 0 ? (
            <p className="muted">Sin registros de uso de APIs.</p>
          ) : (
            <>
              {/* Today summary */}
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${providers.length}, 1fr)`, gap: 12, marginBottom: 16 }}>
                {providers.map((prov) => {
                  const todaySummary = usageByProviderDay.get(prov)?.get(todayStr);
                  return (
                    <div key={prov} className="card" style={{ padding: "12px", margin: 0 }}>
                      <div className="small" style={{ fontWeight: 600, textTransform: "capitalize" }}>{prov}</div>
                      <div className="balance-big">${(todaySummary?.costUsd ?? 0).toFixed(2)}</div>
                      <div className="muted small">
                        {todaySummary?.calls ?? 0} llamadas hoy
                        {(todaySummary?.errors ?? 0) > 0 ? ` · ${todaySummary!.errors} errores` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Daily breakdown */}
              <details>
                <summary className="muted small" style={{ cursor: "pointer" }}>Detalle por día</summary>
                <table style={{ width: "100%", marginTop: 8, fontSize: "0.85rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>Día</th>
                      <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>Proveedor</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)" }}>Llamadas</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)" }}>Errores</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)" }}>Costo est.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.flatMap((prov) => {
                      const dayMap = usageByProviderDay.get(prov)!;
                      return [...dayMap.entries()]
                        .sort(([a], [b]) => b.localeCompare(a))
                        .map(([day, s]) => (
                          <tr key={`${prov}-${day}`}>
                            <td style={{ padding: "4px 0" }}>{day}</td>
                            <td style={{ textTransform: "capitalize" }}>{prov}</td>
                            <td style={{ textAlign: "right" }}>{s.calls}</td>
                            <td style={{ textAlign: "right", color: s.errors > 0 ? "var(--error)" : "inherit" }}>{s.errors}</td>
                            <td style={{ textAlign: "right" }}>${s.costUsd.toFixed(4)}</td>
                          </tr>
                        ));
                    })}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </section>

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
            <section className="card balance-card">
              <div className="muted small" style={{ marginBottom: 4 }}>
                Tiempo de video
              </div>
              <div className="balance-big">{mmss(videoBalance)}</div>
              <div className="muted">disponibles ({videoBalance}s)</div>
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

            {/* Consumption logs */}
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
