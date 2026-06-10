import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { signOut } from "@/app/login/actions";
import { REFERENCE_PHOTOS_BUCKET, type Avatar } from "@/lib/avatars";
import { getBalanceSeconds } from "@/lib/credits";
import BrandMark from "@/app/BrandMark";
import Studio, { type StudioAvatar } from "./Studio";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const accountId = await getAccountId();
  const { data } = await supabase
    .from("avatars")
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const avatars = (data ?? []) as Avatar[];

  // Signed thumbnail + wardrobe/background presets for each avatar.
  const studioAvatars: StudioAvatar[] = await Promise.all(
    avatars.map(async (a) => {
      let thumbnailUrl: string | null = null;
      const first = a.reference_photos?.[0];
      if (first) {
        const { data: signed } = await supabase.storage
          .from(REFERENCE_PHOTOS_BUCKET)
          .createSignedUrl(first, 3600);
        thumbnailUrl = signed?.signedUrl ?? null;
      }

      const [{ data: wardrobe }, { data: background }] = await Promise.all([
        supabase
          .from("wardrobe_presets")
          .select("id, label")
          .eq("avatar_id", a.id)
          .order("label"),
        supabase
          .from("background_presets")
          .select("id, label")
          .eq("avatar_id", a.id)
          .order("label"),
      ]);

      return {
        id: a.id,
        name: a.name,
        hasVoice: Boolean(a.elevenlabs_voice_id),
        defaultLanguage: a.default_language,
        thumbnailUrl,
        wardrobe: wardrobe ?? [],
        background: background ?? [],
      };
    })
  );

  const balanceSeconds = await getBalanceSeconds(supabase, accountId);

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
          <h1 style={{ margin: 0 }}>Estudio</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Guion → voz → vídeo con avatar parlante.
          </p>
        </div>
      </header>

      {studioAvatars.length === 0 ? (
        <div className="card empty">
          <p style={{ marginTop: 0 }}>Aún no hay avatares activos.</p>
          <p className="muted">
            Activa un avatar y clona su voz antes de generar vídeos.
          </p>
          <Link href="/avatars">
            <button type="button">Ir a avatares</button>
          </Link>
        </div>
      ) : (
        <Studio avatars={studioAvatars} balanceSeconds={balanceSeconds} />
      )}
    </main>
  );
}
