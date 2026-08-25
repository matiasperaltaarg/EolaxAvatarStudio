import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import { GENERATED_CONTENT_BUCKET, languageLabel } from "@/lib/avatars";
import AppShell from "@/app/AppShell";
import Toast from "@/app/Toast";
import ConfirmSubmit from "@/app/ConfirmSubmit";
import { deleteVideo } from "./actions";

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

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { error, ok } = await searchParams;
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
    <AppShell>
      <main className="container wide">
        <header className="page-header">
          <div>
            <h1 style={{ margin: 0 }}>Galería</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {videos.length} {videos.length === 1 ? "vídeo generado" : "vídeos generados"}.
            </p>
          </div>
        </header>

        <Toast ok={ok} error={error} />

        {videos.length === 0 ? (
        <div className="card empty">
          <p style={{ marginTop: 0 }}>Aún no hay vídeos.</p>
          <p className="muted">Genera tu primer vídeo en el estudio.</p>
          <Link href="/studio">
            <button type="button">Ir al estudio</button>
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
                <div className="item-actions">
                  {url ? (
                    <a href={url} download={`${v.avatars?.name ?? "video"}_${v.language ?? ""}.mp4`}>
                      <button className="secondary" type="button">Descargar</button>
                    </a>
                  ) : null}
                  <form action={deleteVideo}>
                    <input type="hidden" name="id" value={v.id} />
                    <ConfirmSubmit
                      className="secondary danger-outline"
                      message="¿Eliminar este vídeo? Se borra el archivo de forma permanente. Los créditos ya consumidos no se devuelven."
                    >
                      Eliminar
                    </ConfirmSubmit>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </main>
    </AppShell>
  );
}
