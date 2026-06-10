import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signIn } from "./actions";
import BrandMark from "@/app/BrandMark";
import { BRAND } from "@/lib/brand";

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
      <div className="login-hero">
        <BrandMark size="lg" />
        <p className="tagline">{BRAND.tagline}</p>
      </div>
      <div className="card">
        <h1 style={{ marginTop: 0, fontSize: 18 }}>Iniciar sesión</h1>
        <p className="muted">Accede para continuar.</p>

        {error ? <p className="error">{error}</p> : null}

        <form action={signIn}>
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" name="email" type="email" required autoComplete="email" />

          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />

          <button type="submit">Entrar</button>
        </form>
      </div>
    </main>
  );
}
