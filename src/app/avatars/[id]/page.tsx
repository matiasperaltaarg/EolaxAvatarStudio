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
  deletePhoto,
  updateAvatar,
} from "../actions";
import Toast from "./Toast";
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
    <main className="container wide">
      <p>
        <Link href="/avatars">← Back to avatars</Link>
      </p>

      <header className="page-header">
        <h1 style={{ margin: 0 }}>{avatar.name}</h1>
        <div className="row">
          <span className={`badge rights-${avatar.rights_confirmed}`}>
            {avatar.rights_confirmed ? "Rights ✓" : "Rights pending"}
          </span>
          <span className={`badge status-${avatar.status}`}>{avatar.status}</span>
        </div>
      </header>

      <Toast ok={ok} error={error} />

      {/* Reference photos -------------------------------------------------- */}
      <section className="card">
        <h2>Reference photos</h2>
        {photoUrls.length === 0 ? (
          <p className="muted">No photos uploaded.</p>
        ) : (
          <div className="photo-grid">
            {photoUrls.map((p) => (
              <div key={p.path} className="photo-cell">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="Reference" className="photo" />
                <form action={deletePhoto}>
                  <input type="hidden" name="id" value={avatar.id} />
                  <input type="hidden" name="path" value={p.path} />
                  <button className="photo-delete" type="submit" title="Delete photo">
                    ✕
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
        <form action={addPhotos} encType="multipart/form-data" className="inline-form">
          <input type="hidden" name="id" value={avatar.id} />
          <input name="photos" type="file" accept="image/*" multiple required />
          <button className="secondary" type="submit">
            Add photos
          </button>
        </form>
      </section>

      {/* Rights gate ------------------------------------------------------- */}
      <section className="card">
        <h2>Legal rights gate</h2>
        {avatar.rights_confirmed ? (
          <p className="ok">
            ✓ Signed image and voice rights are confirmed on file for this
            person.
          </p>
        ) : (
          <>
            <p className="muted">
              Before this avatar can be activated, signed rights covering{" "}
              <strong>both image AND voice</strong> for AI generation must be on
              file, plus an AI-disclosure agreement.
            </p>
            <form action={confirmRights}>
              <input type="hidden" name="id" value={avatar.id} />
              <label className="checkbox-row">
                <input type="checkbox" name="acknowledge" />
                <span>
                  I confirm that signed image AND voice rights for AI generation,
                  and the AI-disclosure agreement, are on file for this person.
                </span>
              </label>
              <button type="submit">Confirm rights on file</button>
            </form>
          </>
        )}
      </section>

      {/* Status / activation ---------------------------------------------- */}
      <section className="card">
        <h2>Status</h2>
        {avatar.status === "active" ? (
          <>
            <p className="ok">This avatar is active.</p>
            <form action={deactivateAvatar}>
              <input type="hidden" name="id" value={avatar.id} />
              <button className="secondary" type="submit">
                Set back to draft
              </button>
            </form>
          </>
        ) : avatar.rights_confirmed ? (
          <form action={activateAvatar}>
            <input type="hidden" name="id" value={avatar.id} />
            <button type="submit">Activate avatar</button>
          </form>
        ) : (
          <p className="muted">
            Activation is blocked. Confirm the legal rights above to enable it.
          </p>
        )}
      </section>

      {/* Voice cloning ----------------------------------------------------- */}
      <VoiceCloning
        avatarId={avatar.id}
        hasRights={avatar.rights_confirmed}
        existingVoiceId={avatar.elevenlabs_voice_id}
      />

      {/* Voice test (only once a voice is cloned) -------------------------- */}
      {avatar.elevenlabs_voice_id ? (
        <VoiceTest avatarId={avatar.id} defaultLanguage={avatar.default_language} />
      ) : null}

      {/* Edit -------------------------------------------------------------- */}
      <section className="card">
        <h2>Edit</h2>
        <p className="muted small">
          Personality and default language can be edited in any status.
        </p>
        <form action={updateAvatar}>
          <input type="hidden" name="id" value={avatar.id} />

          <label htmlFor="default_language">Default language</label>
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

          <label htmlFor="personality_editable">Personality</label>
          <textarea
            id="personality_editable"
            name="personality_editable"
            rows={4}
            defaultValue={avatar.personality_editable ?? ""}
          />

          <button type="submit">Save changes</button>
        </form>
      </section>

      {/* Danger zone ------------------------------------------------------- */}
      <section className="card danger">
        <h2>Delete</h2>
        <p className="muted small">
          Current language: {languageLabel(avatar.default_language)}. Deleting
          removes the avatar and its reference photos permanently.
        </p>
        <form action={deleteAvatar}>
          <input type="hidden" name="id" value={avatar.id} />
          <button className="danger-btn" type="submit">
            Delete avatar
          </button>
        </form>
      </section>
    </main>
  );
}
