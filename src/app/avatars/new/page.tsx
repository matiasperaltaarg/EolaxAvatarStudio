import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAvatar } from "../actions";
import { LANGUAGES } from "@/lib/avatars";

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
    <main className="container">
      <p>
        <Link href="/avatars">← Back to avatars</Link>
      </p>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>New avatar</h1>
        <p className="muted">
          New avatars start as a <strong>draft</strong>. They can only be
          activated once signed image and voice rights are confirmed.
        </p>

        {error ? <p className="error">{error}</p> : null}

        <form action={createAvatar} encType="multipart/form-data">
          <label htmlFor="name">Avatar name</label>
          <input id="name" name="name" type="text" required />

          <label htmlFor="default_language">Default language</label>
          <select id="default_language" name="default_language" defaultValue="es">
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>

          <label htmlFor="personality_editable">Personality (tone, topics, style)</label>
          <textarea
            id="personality_editable"
            name="personality_editable"
            rows={4}
            placeholder="e.g. Warm, upbeat brand voice. Talks about product launches and tips."
          />

          <label htmlFor="photos">Reference photos (1 or more)</label>
          <input
            id="photos"
            name="photos"
            type="file"
            accept="image/*"
            multiple
            required
          />
          <p className="muted small">
            Stored privately in Supabase Storage. Used later for image
            calibration.
          </p>

          <button type="submit">Create draft avatar</button>
        </form>
      </div>
    </main>
  );
}
