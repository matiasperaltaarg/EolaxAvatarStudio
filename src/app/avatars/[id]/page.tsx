import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/account";
import {
  LANGUAGES,
  REFERENCE_PHOTOS_BUCKET,
  languageLabel,
  type Avatar,
} from "@/lib/avatars";
import {
  activateAvatar,
  addPhotos,
  confirmRights,
  deactivateAvatar,
  deleteAvatar,
  deleteClonedVoice,
  deletePhoto,
  updateAvatar,
} from "../actions";
import AppShell from "@/app/AppShell";
import Toast from "@/app/Toast";
import ConfirmSubmit from "@/app/ConfirmSubmit";
import VoiceCloning from "./VoiceCloning";
import VoiceTest from "./VoiceTest";

export const dynamic = "force-dynamic";

export default async function AvatarDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const { error, ok } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const accountId = await getAccountId();
  const { data } = await supabase
    .from("avatars")
    .select("*")
    .eq("id", id)
    .eq("account_id", accountId)
    .single();

  if (!data) notFound();
  const avatar = data as Avatar;

  // Private bucket — generate short-lived signed URLs for display.
  let photoUrls: { path: string; url: string }[] = [];
  if (avatar.reference_photos?.length) {
    const { data: signed } = await supabase.storage
      .from(REFERENCE_PHOTOS_BUCKET)
      .createSignedUrls(avatar.reference_photos, 3600);
    photoUrls = (signed ?? []).flatMap((s) =>
      s.signedUrl ? [{ path: s.path ?? "", url: s.signedUrl }] : []
    );
  }

  return (
    <AppShell>
    <main className="container wide">
      <p>
        <Link href="/avatars">← Volver a avatares</Link>
      </p>

      <header className="page-header">
        <h1 style={{ margin: 0 }}>{avatar.name}</h1>
        <div className="row">
          <span className={`badge rights-${avatar.rights_confirmed}`}>
            {avatar.rights_confirmed ? "Derechos ✓" : "Derechos pendientes"}
          </span>
          <span className={`badge status-${avatar.status}`}>
            {avatar.status === "active" ? "activo" : "borrador"}
          </span>
        </div>
      </header>

      <Toast ok={ok} error={error} />

      {/* Reference photos -------------------------------------------------- */}
      <section className="card">
        <h2>Fotos de referencia</h2>
        {photoUrls.length === 0 ? (
          <p className="muted">No hay fotos subidas.</p>
        ) : (
          <div className="photo-grid">
            {photoUrls.map((p) => (
              <div key={p.path} className="photo-cell">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="Referencia" className="photo" />
                <form action={deletePhoto}>
                  <input type="hidden" name="id" value={avatar.id} />
                  <input type="hidden" name="path" value={p.path} />
                  <ConfirmSubmit
                    className="photo-delete"
                    title="Eliminar foto"
                    message="¿Eliminar esta foto de referencia?"
                    pendingLabel="…"
                  >
                    ✕
                  </ConfirmSubmit>
                </form>
              </div>
            ))}
          </div>
        )}
        <form action={addPhotos} encType="multipart/form-data" className="inline-form">
          <input type="hidden" name="id" value={avatar.id} />
          <input name="photos" type="file" accept="image/*" multiple required />
          <button className="secondary" type="submit">
            Añadir fotos
          </button>
        </form>
      </section>

      {/* Rights gate ------------------------------------------------------- */}
      <section className="card">
        <h2>Verificación de derechos</h2>
        {avatar.rights_confirmed ? (
          <p className="ok">
            ✓ Los derechos firmados de imagen y voz están confirmados para esta
            persona.
          </p>
        ) : (
          <>
            <p className="muted">
              Antes de activar este avatar deben constar los derechos firmados de{" "}
              <strong>imagen Y voz</strong> para generación con IA, además del
              acuerdo de divulgación de IA.
            </p>
            <form action={confirmRights}>
              <input type="hidden" name="id" value={avatar.id} />
              <label className="checkbox-row">
                <input type="checkbox" name="acknowledge" />
                <span>
                  Confirmo que constan los derechos firmados de imagen Y voz para
                  generación con IA, y el acuerdo de divulgación de IA, de esta
                  persona.
                </span>
              </label>
              <button type="submit">Confirmar derechos</button>
            </form>
          </>
        )}
      </section>

      {/* Status / activation ---------------------------------------------- */}
      <section className="card">
        <h2>Estado</h2>
        {avatar.status === "active" ? (
          <>
            <p className="ok">Este avatar está activo.</p>
            <form action={deactivateAvatar}>
              <input type="hidden" name="id" value={avatar.id} />
              <button className="secondary" type="submit">
                Volver a borrador
              </button>
            </form>
          </>
        ) : avatar.rights_confirmed ? (
          <form action={activateAvatar}>
            <input type="hidden" name="id" value={avatar.id} />
            <button type="submit">Activar avatar</button>
          </form>
        ) : (
          <p className="muted">
            La activación está bloqueada. Confirma los derechos legales arriba
            para habilitarla.
          </p>
        )}
      </section>

      {/* Voice cloning ----------------------------------------------------- */}
      {/* key: remount when the voice is (re)cloned or deleted, so the card
          never keeps showing a voice that no longer exists. */}
      <VoiceCloning
        key={avatar.elevenlabs_voice_id ?? "no-voice"}
        avatarId={avatar.id}
        accountId={accountId}
        hasRights={avatar.rights_confirmed}
        existingVoiceId={avatar.elevenlabs_voice_id}
      />

      {/* Voice test (only once a voice is cloned) -------------------------- */}
      {avatar.elevenlabs_voice_id ? (
        <VoiceTest avatarId={avatar.id} defaultLanguage={avatar.default_language} />
      ) : null}

      {/* Edit -------------------------------------------------------------- */}
      <section className="card">
        <h2>Editar</h2>
        <p className="muted small">
          La personalidad y el idioma por defecto se pueden editar en cualquier
          estado.
        </p>
        <form action={updateAvatar}>
          <input type="hidden" name="id" value={avatar.id} />

          <label htmlFor="default_language">Idioma por defecto</label>
          <select
            id="default_language"
            name="default_language"
            defaultValue={avatar.default_language}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>

          <label htmlFor="personality_editable">Personalidad</label>
          <textarea
            id="personality_editable"
            name="personality_editable"
            rows={4}
            defaultValue={avatar.personality_editable ?? ""}
          />

          <button type="submit">Guardar cambios</button>
        </form>
      </section>

      {/* Danger zone ------------------------------------------------------- */}
      <section className="card danger">
        <h2>Zona de peligro</h2>

        {avatar.elevenlabs_voice_id ? (
          <div className="danger-action">
            <div>
              <strong>Eliminar voz clonada</strong>
              <p className="muted small" style={{ margin: "2px 0 0" }}>
                Borra la voz en ElevenLabs y los audios de referencia. El avatar
                se mantiene y podés volver a clonar la voz cuando quieras.
              </p>
            </div>
            <form action={deleteClonedVoice}>
              <input type="hidden" name="id" value={avatar.id} />
              <ConfirmSubmit
                className="secondary danger-outline"
                message="¿Eliminar la voz clonada de este avatar? Vas a tener que volver a grabar o subir audio para clonarla de nuevo."
              >
                Eliminar voz
              </ConfirmSubmit>
            </form>
          </div>
        ) : null}

        <div className="danger-action">
          <div>
            <strong>Eliminar avatar</strong>
            <p className="muted small" style={{ margin: "2px 0 0" }}>
              Permanente. Borra el avatar, sus fotos de referencia, su voz
              clonada y <strong>todos los vídeos generados con él</strong>.
              Idioma actual: {languageLabel(avatar.default_language)}. No
              devuelve créditos ya consumidos.
            </p>
          </div>
          <form action={deleteAvatar}>
            <input type="hidden" name="id" value={avatar.id} />
            <ConfirmSubmit
              className="danger-btn"
              message={`¿Eliminar el avatar "${avatar.name}"? Se borran también sus fotos, su voz clonada y todos sus vídeos generados. Esta acción no se puede deshacer.`}
            >
              Eliminar avatar
            </ConfirmSubmit>
          </form>
        </div>
      </section>
    </main>
    </AppShell>
  );
}
