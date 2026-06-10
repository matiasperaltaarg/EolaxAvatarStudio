import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { signOut } from "@/app/login/actions";
import { GENERATED_CONTENT_BUCKET, languageLabel } from "@/lib/avatars";

export const dynamic = "force-dynamic";

type GalleryVideo = {
  id: string;
  language: string | null;
  aspect_ratio: string | null;
  duration_seconds: number | null;
  overlay_text: string | null;
  output_url: string | null;
  created_at: string;
  avatars: { name: string } | null;
};

export default async function GalleryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const accountId = await getAccountId();
  const { data } = await supabase
    .from("videos")
    .select(
      "id, language, aspect_ratio, duration_seconds, overlay_text, output_url, created_at, avatars!inner(name, account_id)"
    )
    .eq("avatars.account_id", accountId)
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  const videos = (data ?? []) as unknown as GalleryVideo[];

  // Batch-sign the storage paths for playback/download.
  const paths = videos.map((v) => v.output_url).filter((p): p is string => Boolean(p));
  const signedMap = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(GENERATED_CONTENT_BUCKET)
      .createSignedUrls(paths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
    }
  }

  return (
    <main className="container wide">
      <header className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Gallery</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {videos.length} generated video{videos.length === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="row">
          <Link href="/studio">
            <button className="secondary" type="button">Studio</button>
          </Link>
          <Link href="/credits">
            <button className="secondary" type="button">Credits</button>
          </Link>
          <form action={signOut}>
            <button className="secondary" type="submit">Sign out</button>
          </form>
        </div>
      </header>

      {videos.length === 0 ? (
        <div className="card empty">
          <p style={{ marginTop: 0 }}>No videos yet.</p>
          <p className="muted">Generate your first video in the studio.</p>
          <Link href="/studio">
            <button type="button">Go to studio</button>
          </Link>
        </div>
      ) : (
        <div className="gallery-grid">
          {videos.map((v) => {
            const url = v.output_url ? signedMap.get(v.output_url) : undefined;
            return (
              <div key={v.id} className="card gallery-item">
                {url ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video controls preload="metadata" src={url} className="result-video" />
                ) : (
                  <p className="muted small">Video unavailable.</p>
                )}
                <div className="result-meta">
                  <strong>{v.avatars?.name ?? "Avatar"}</strong>
                  <span className="muted small">
                    {v.language ? languageLabel(v.language) : "—"} · {v.aspect_ratio ?? "—"} ·{" "}
                    {v.duration_seconds ? `${Math.round(v.duration_seconds)}s` : "—"}
                  </span>
                  <span className="muted small">
                    {new Date(v.created_at).toLocaleDateString()}
                    {v.overlay_text ? ` · “${v.overlay_text}”` : ""}
                  </span>
                </div>
                {url ? (
                  <a href={url} download={`${v.avatars?.name ?? "video"}_${v.language ?? ""}.mp4`}>
                    <button className="secondary" type="button">Download</button>
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
