import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import {
  PACKS,
  getBalanceSeconds,
  getVideoChargeLog,
  type CreditPack,
  type VideoChargeRow,
} from "@/lib/credits";
import { languageLabel } from "@/lib/avatars";
import AppShell from "@/app/AppShell";

export const dynamic = "force-dynamic";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}m ${s}s`;
}

export default async function CreditsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const accountId = await getAccountId();

  const [balance, packsRes, log] = await Promise.all([
    getBalanceSeconds(supabase, accountId),
    supabase
      .from("credit_packs")
      .select("*")
      .eq("account_id", accountId)
      .order("purchased_at", { ascending: false }),
    getVideoChargeLog(supabase, accountId, 25),
  ]);

  const packs = (packsRes.data ?? []) as CreditPack[];

  const now = Date.now();

  return (
    <AppShell>
    <main className="container wide">
      <header className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Créditos</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Los créditos se miden en segundos de vídeo generado.
          </p>
        </div>
      </header>

      <section className="card balance-card">
        <div className="muted small" style={{ marginBottom: 4 }}>Tiempo de video</div>
        <div className="balance-big">{mmss(balance)}</div>
        <div className="muted">disponibles ({balance}s)</div>
      </section>

      <p className="muted small">
        Sin cuota mensual. Cada pack es válido durante 6 meses. Cada generación
        (incluidas las regeneraciones) consume créditos de video. Crear avatares
        es gratis. Las generaciones fallidas no se cobran.
      </p>

      <section className="card">
        <h2>Packs</h2>
        {packs.length === 0 ? (
          <p className="muted">
            Aún no hay packs. Contacta con MTS para añadir un pack de créditos a
            esta cuenta.
          </p>
        ) : (
          <ul className="pack-list">
            {packs.map((p) => {
              const expired = new Date(p.expires_at).getTime() < now;
              const remaining = Math.max(0, p.seconds_total - p.seconds_used);
              return (
                <li key={p.id} className={`pack-row${expired ? " expired" : ""}`}>
                  <div>
                    <strong>{PACKS[p.pack_type]?.label ?? p.pack_type}</strong>
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

      <section className="card">
        <h2>Consumo reciente de video</h2>
        {log.length === 0 ? (
          <p className="muted">Aún no se ha cobrado ninguna generación.</p>
        ) : (
          <ul className="pack-list">
            {log.map((row: VideoChargeRow, i: number) => (
              <li key={i} className="pack-row">
                <div>
                  <strong>{row.avatar_name ?? "Avatar"}</strong>
                  <span className="muted small">
                    {" "}· {row.language ? languageLabel(row.language) : "—"}
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
    </main>
    </AppShell>
  );
}
