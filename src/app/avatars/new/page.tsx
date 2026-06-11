import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAvatar } from "../actions";
import { LANGUAGES } from "@/lib/avatars";
import AppShell from "@/app/AppShell";

export const dynamic = "force-dynamic";

export default async function NewAvatarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await searchParams;

  return (
    <AppShell>
    <main className="container">
      <p>
        <Link href="/avatars">← Volver a avatares</Link>
      </p>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Nuevo avatar</h1>
        <p className="muted">
          Los avatares nuevos empiezan como <strong>borrador</strong>. Solo
          pueden activarse cuando se confirman los derechos de imagen y voz
          firmados.
        </p>

        {error ? <p className="error">{error}</p> : null}

        <form action={createAvatar} encType="multipart/form-data">
          <label htmlFor="name">Nombre del avatar</label>
          <input id="name" name="name" type="text" required />

          <label htmlFor="default_language">Idioma por defecto</label>
          <select id="default_language" name="default_language" defaultValue="es">
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>

          <label htmlFor="personality_editable">Personalidad (tono, temas, estilo)</label>
          <textarea
            id="personality_editable"
            name="personality_editable"
            rows={4}
            placeholder="p. ej. Voz de marca cercana y enérgica. Habla de lanzamientos y consejos."
          />

          <label htmlFor="photos">Fotos de referencia (1 o más)</label>
          <input
            id="photos"
            name="photos"
            type="file"
            accept="image/*"
            multiple
            required
          />
          <p className="muted small">
            Se guardan de forma privada en Supabase Storage. Se usan después para
            la calibración de imagen.
          </p>

          <button type="submit">Crear avatar (borrador)</button>
        </form>
      </div>
    </main>
    </AppShell>
  );
}
