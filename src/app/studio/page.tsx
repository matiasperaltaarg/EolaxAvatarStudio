import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { signOut } from "@/app/login/actions";
import { REFERENCE_PHOTOS_BUCKET, type Avatar } from "@/lib/avatars";
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

  return (
    <main className="container wide">
      <header className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Studio</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Script → voice → talking-head video.
          </p>
        </div>
        <div className="row">
          <Link href="/avatars">
            <button className="secondary" type="button">
              Avatars
            </button>
          </Link>
          <form action={signOut}>
            <button className="secondary" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {studioAvatars.length === 0 ? (
        <div className="card empty">
          <p style={{ marginTop: 0 }}>No active avatars yet.</p>
          <p className="muted">
            Activate an avatar and clone its voice before generating videos.
          </p>
          <Link href="/avatars">
            <button type="button">Go to avatars</button>
          </Link>
        </div>
      ) : (
        <Studio avatars={studioAvatars} />
      )}
    </main>
  );
}
