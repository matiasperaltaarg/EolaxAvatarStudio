"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BrandMark from "@/app/BrandMark";
import { BRAND } from "@/lib/brand";

// Public page where an INVITED user sets their own password. Supabase's invite
// email links here with a session token in the URL hash; @supabase/ssr picks it
// up automatically, giving a temporary authenticated session. The user types a
// new password, we call updateUser, and they're in — the owner never sees it.
export default function SetPasswordPage() {
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // On mount, confirm there is a (temporary) session from the invite link.
  // The Supabase client is created lazily here (and in handleSubmit) so it never
  // runs during server prerender — it needs the browser to read the URL hash.
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    // Give supabase-js a tick to parse the hash token from the URL.
    const t = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setHasSession(!!data.session);
      setReady(true);
    }, 400);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: updErr } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updErr) {
      setError("No se pudo guardar la contraseña. El enlace puede haber expirado — pedí una nueva invitación.");
      return;
    }
    // Success → go to the app.
    router.push("/");
  }

  return (
    <main className="container">
      <div className="login-hero">
        <BrandMark size="lg" />
        <p className="tagline">{BRAND.tagline}</p>
      </div>
      <div className="card">
        <h1 style={{ marginTop: 0, fontSize: 18 }}>Creá tu contraseña</h1>
        <p className="muted">Definí una contraseña para acceder a tu cuenta.</p>

        {ready && !hasSession ? (
          <p className="error">
            Este enlace no es válido o expiró. Pedí una nueva invitación al equipo de MTS.
          </p>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        <form onSubmit={handleSubmit}>
          <label htmlFor="password">Nueva contraseña</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!hasSession || saving}
          />

          <label htmlFor="confirm">Repetí la contraseña</label>
          <input
            id="confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={!hasSession || saving}
          />

          <button type="submit" disabled={!hasSession || saving}>
            {saving ? "Guardando…" : "Guardar y entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
