import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { signOut } from "@/app/login/actions";
import { PACKS, getBalanceSeconds, type CreditPack } from "@/lib/credits";
import { languageLabel } from "@/lib/avatars";
import BrandMark from "@/app/BrandMark";

export const dynamic = "force-dynamic";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}m ${s}s`;
}

type LogRow = {
  seconds_charged: number;
  created_at: string;
  videos: { language: string | null; avatars: { name: string } | null } | null;
};

export default async function CreditsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const accountId = await getAccountId();

  const [balance, packsRes, logRes] = await Promise.all([
    getBalanceSeconds(supabase, accountId),
    supabase
      .from("credit_packs")
      .select("*")
      .eq("account_id", accountId)
      .order("purchased_at", { ascending: false }),
    supabase
      .from("generations_log")
      .select("seconds_charged, created_at, videos!inner(language, avatars!inner(name, account_id))")
      .eq("videos.avatars.account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const packs = (packsRes.data ?? []) as CreditPack[];
  const log = (logRes.data ?? []) as unknown as LogRow[];
  const now = Date.now();

  return (
    <main className="container wide">
      <div className="brand-header">
        <BrandMark />
        <div className="row">
          <Link href="/studio"><button className="secondary" type="button">Estudio</button></Link>
          <Link href="/gallery"><button className="secondary" type="button">Galería</button></Link>
          <Link href="/credits"><button className="secondary" type="button">Créditos</button></Link>
          <Link href="/avatars"><button className="secondary" type="button">Avatares</button></Link>
          <form action={signOut}>
            <button className="secondary" type="submit">Salir</button>
          </form>
        </div>
      </div>

      <header className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Créditos</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Los créditos se miden en segundos de vídeo generado.
          </p>
        </div>
      </header>

      <section className="card balance-card">
        <div className="balance-big">{mmss(balance)}</div>
        <div className="muted">disponibles ({balance}s)</div>
      </section>

      <p className="muted small">
        Sin cuota mensual. Cada pack es válido durante 6 meses. Cada generación
        (incluidas las regeneraciones) consume créditos. Las generaciones
        fallidas no se cobran.
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
        <h2>Consumo reciente</h2>
        {log.length === 0 ? (
          <p className="muted">Aún no se ha cobrado ninguna generación.</p>
        ) : (
          <ul className="pack-list">
            {log.map((row, i) => (
              <li key={i} className="pack-row">
                <div>
                  <strong>{row.videos?.avatars?.name ?? "Avatar"}</strong>
                  <span className="muted small">
                    {" "}· {row.videos?.language ? languageLabel(row.videos.language) : "—"}
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
  );
}
