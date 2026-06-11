"use client";

import { useMemo, useState } from "react";
import {
  ASPECT_RATIOS,
  STUDIO_LANGUAGES,
  REFERENCE_PHOTOS_BUCKET,
  estimateDurationSeconds,
  studioLanguage,
} from "@/lib/avatars";
import { createClient } from "@/lib/supabase/client";

export type StudioAvatar = {
  id: string;
  name: string;
  hasVoice: boolean;
  defaultLanguage: string;
  thumbnailUrl: string | null;
  photos: { path: string; url: string }[];
  wardrobe: { id: string; label: string }[];
  background: { id: string; label: string }[];
};

type StepKey = "queued" | "translating" | "voice" | "video" | "done" | "error";

type LangProgress = {
  code: string;
  step: StepKey;
  note?: string;
  error?: string;
  videoUrl?: string;
  videoId?: string;
  durationSeconds?: number;
};

const STEP_LABEL: Record<StepKey, string> = {
  queued: "En cola…",
  translating: "Traduciendo…",
  voice: "Generando voz…",
  video: "Creando vídeo con sincronización labial…",
  done: "Listo ✓",
  error: "Error",
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// WaveSpeed sometimes fails a render because its model server didn't cold-boot
// in time ("Server did not start within 120 seconds"). That's transient — a
// fresh submit usually lands on a warm/healthy worker, so we auto-resubmit.
function isTransientVideoError(message: string): boolean {
  return /did not start|failed to start|server error|try again|timeout|timed out|unavailable|boot/i.test(
    message
  );
}

const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 240; // per attempt: 240 × 5s = 20 min of patience
const MAX_VIDEO_ATTEMPTS = 3;

export default function Studio({
  avatars,
  balanceSeconds,
  accountId,
}: {
  avatars: StudioAvatar[];
  balanceSeconds: number;
  accountId: string;
}) {
  const [phase, setPhase] = useState<"form" | "running" | "results">("form");

  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [improving, setImproving] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState("9:16");

  // Look (wardrobe + background presets). On-screen text overlay is PARKED
  // (removed from the flow — see finalize route note); may return later via a
  // non-serverless-ffmpeg approach.
  const [wardrobeId, setWardrobeId] = useState<string>("");
  const [backgroundId, setBackgroundId] = useState<string>("");
  const [lookMode, setLookMode] = useState<"preset" | "free">("preset");
  const [freePrompt, setFreePrompt] = useState<string>("");
  const [lookImageUrl, setLookImageUrl] = useState<string | null>(null);
  const [lookKey, setLookKey] = useState<string>(""); // selection the look image matches
  const [applyingLook, setApplyingLook] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);

  const [progress, setProgress] = useState<LangProgress[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);

  // Base photo for THIS video: defaults to the avatar's first photo, but the
  // user can pick another of the avatar's photos or upload a new one (used only
  // for this video, not saved to the avatar). baseImagePath drives the look
  // edit; baseImageUrl is the signed URL used directly when no look is applied.
  const [baseImagePath, setBaseImagePath] = useState<string | null>(null);
  const [baseImageUrl, setBaseImageUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const selectedAvatar = avatars.find((a) => a.id === avatarId) ?? null;
  const charCount = script.trim().length;
  const estSeconds = estimateDurationSeconds(script);

  const trimmedFreePrompt = freePrompt.trim();
  const hasLookSelection =
    lookMode === "free" ? trimmedFreePrompt.length > 0 : Boolean(wardrobeId && backgroundId);
  const currentLookKey =
    lookMode === "free" ? `free|${trimmedFreePrompt}` : `preset|${wardrobeId}|${backgroundId}`;
  const lookReady = lookImageUrl !== null && lookKey === currentLookKey;

  // Credit pre-check: estimate seconds × number of languages. The ACTUAL
  // duration is debited server-side on completion.
  const estimatedCost = estSeconds * languages.length;
  const enoughCredits = estimatedCost <= balanceSeconds;

  const canGenerate =
    Boolean(selectedAvatar?.hasVoice) &&
    charCount > 0 &&
    languages.length > 0 &&
    enoughCredits;

  function selectAvatar(a: StudioAvatar) {
    setAvatarId(a.id);
    // Pre-select the avatar's default language if nothing chosen yet.
    setLanguages((prev) =>
      prev.length === 0 && studioLanguage(a.defaultLanguage) ? [a.defaultLanguage] : prev
    );
    // Default the base photo to the avatar's first photo.
    setBaseImagePath(a.photos[0]?.path ?? null);
    setBaseImageUrl(a.photos[0]?.url ?? null);
    setPhotoError(null);
    // Reset the look — presets are per avatar.
    setWardrobeId("");
    setBackgroundId("");
    setLookMode(a.wardrobe.length === 0 && a.background.length === 0 ? "free" : "preset");
    setFreePrompt("");
    setLookImageUrl(null);
    setLookKey("");
    setLookError(null);
  }

  // Switch the base photo to another of the avatar's existing photos.
  // Any applied look was computed on the previous photo, so invalidate it.
  function chooseExistingPhoto(path: string, url: string) {
    setBaseImagePath(path);
    setBaseImageUrl(url);
    setPhotoError(null);
    setLookImageUrl(null);
    setLookKey("");
  }

  // Upload a new photo to Storage for THIS video only (not saved to the avatar).
  // Direct browser → Storage upload (same pattern as voice, avoids body limits).
  async function uploadNewPhoto(file: File) {
    if (!selectedAvatar) return;
    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      const supabase = createClient();
      const dot = file.name.lastIndexOf(".");
      const ext =
        dot >= 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "jpg";
      const path = `${accountId}/${selectedAvatar.id}/adhoc/${crypto.randomUUID()}.${ext || "jpg"}`;
      const { error: upErr } = await supabase.storage
        .from(REFERENCE_PHOTOS_BUCKET)
        .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
      if (upErr) throw new Error(upErr.message);

      const { data: signed } = await supabase.storage
        .from(REFERENCE_PHOTOS_BUCKET)
        .createSignedUrl(path, 3600);
      if (!signed?.signedUrl) throw new Error("No se pudo leer la foto subida.");

      // Use the new photo as the base; invalidate any prior look.
      setBaseImagePath(path);
      setBaseImageUrl(signed.signedUrl);
      setLookImageUrl(null);
      setLookKey("");
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "No se pudo subir la foto.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function applyLook(): Promise<string> {
    if (!selectedAvatar || !hasLookSelection) throw new Error("Select a look first.");
    setApplyingLook(true);
    setLookError(null);
    try {
      const payload =
        lookMode === "free"
          ? { avatarId: selectedAvatar.id, freePrompt: trimmedFreePrompt, baseImagePath }
          : {
              avatarId: selectedAvatar.id,
              wardrobePresetId: wardrobeId,
              backgroundPresetId: backgroundId,
              baseImagePath,
            };
      const res = await fetch("/api/studio/look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not apply the look.");
      setLookImageUrl(json.imageUrl);
      setLookKey(currentLookKey);
      return json.imageUrl as string;
    } catch (e) {
      setLookError(e instanceof Error ? e.message : "Could not apply the look.");
      throw e;
    } finally {
      setApplyingLook(false);
    }
  }

  const results = useMemo(
    () => progress.filter((p) => p.step === "done" && p.videoUrl),
    [progress]
  );

  function toggleLanguage(code: string) {
    setLanguages((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  async function onImprove() {
    if (!script.trim()) return;
    setImproving(true);
    setImproveError(null);
    setSuggestion(null);
    try {
      const res = await fetch("/api/studio/improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, avatarId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Improvement failed.");
      setSuggestion(json.improved);
    } catch (e) {
      setImproveError(e instanceof Error ? e.message : "Improvement failed.");
    } finally {
      setImproving(false);
    }
  }

  function setStep(code: string, patch: Partial<LangProgress>) {
    setProgress((prev) => prev.map((p) => (p.code === code ? { ...p, ...patch } : p)));
  }

  // Submit one render and poll it to completion. Returns the finished video
  // URL, or throws on a non-transient failure. Each poll is a fast, independent
  // request, so no serverless function ever blocks on the render.
  async function submitAndPoll(
    avatarId: string,
    audioUrl: string,
    imageUrl: string | null
  ): Promise<string> {
    const sRes = await fetch("/api/studio/video/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarId, audioUrl, imageUrl }),
    });
    const sJson = await sRes.json();
    if (!sRes.ok) throw new Error(sJson.error ?? "Could not start video.");
    const predictionId: string = sJson.predictionId;

    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const pRes = await fetch(`/api/studio/video/status?id=${encodeURIComponent(predictionId)}`);
      const pJson = await pRes.json();
      if (!pRes.ok) throw new Error(pJson.error ?? "Status check failed.");
      if (pJson.status === "succeeded") {
        if (!pJson.videoUrl) throw new Error("No output video was returned.");
        return pJson.videoUrl as string;
      }
      if (pJson.status === "failed" || pJson.status === "canceled") {
        throw new Error(pJson.error ? String(pJson.error) : `lip-sync ${pJson.status}`);
      }
      // still processing → keep polling
    }
    throw new Error("timed out waiting for the result.");
  }

  // Wraps submitAndPoll with auto-resubmit on transient WaveSpeed startup
  // errors (a fresh submit usually hits a healthy worker).
  async function generateVideo(
    avatarId: string,
    audioUrl: string,
    imageUrl: string | null,
    code: string
  ): Promise<string> {
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_VIDEO_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          setStep(code, { step: "video", note: `retry ${attempt}/${MAX_VIDEO_ATTEMPTS}…` });
        }
        return await submitAndPoll(avatarId, audioUrl, imageUrl);
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Video failed.";
        if (attempt < MAX_VIDEO_ATTEMPTS && isTransientVideoError(lastError)) {
          await sleep(2000);
          continue;
        }
        break;
      }
    }
    throw new Error(`Video: ${lastError}`);
  }

  async function runLanguage(code: string, jobId: string, lookUrl: string | null) {
    const avatar = selectedAvatar!;
    try {
      // a) Translate.
      setStep(code, { step: "translating" });
      const trRes = await fetch("/api/studio/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: script, language: code }),
      });
      const trJson = await trRes.json();
      if (!trRes.ok) throw new Error(`Translation: ${trJson.error}`);
      const translated: string = trJson.text;

      // b) Voice.
      setStep(code, { step: "voice" });
      const vRes = await fetch("/api/studio/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarId: avatar.id, jobId, language: code, text: translated }),
      });
      const vJson = await vRes.json();
      if (!vRes.ok) throw new Error(`Voice: ${vJson.error}`);
      const audioUrl: string = vJson.audioUrl;
      const durationSeconds: number = vJson.durationSeconds;

      // c) Video — async submit + poll, with auto-resubmit on transient
      //    WaveSpeed startup failures. No single request waits for the render;
      //    the client just keeps polling each fast status call.
      setStep(code, { step: "video", note: undefined });
      const finishedVideoUrl = await generateVideo(avatar.id, audioUrl, lookUrl, code);

      // d) Save: store the WaveSpeed video directly + create DB row + debit.
      const fRes = await fetch("/api/studio/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatarId: avatar.id,
          jobId,
          language: code,
          aspectRatio,
          originalScript: script,
          durationSeconds,
          videoUrl: finishedVideoUrl,
          wardrobePresetId: lookMode === "preset" && hasLookSelection ? wardrobeId : null,
          backgroundPresetId: lookMode === "preset" && hasLookSelection ? backgroundId : null,
        }),
      });
      const fJson = await fRes.json();
      if (!fRes.ok) throw new Error(`Saving: ${fJson.error}`);

      setStep(code, {
        step: "done",
        videoUrl: fJson.videoUrl,
        videoId: fJson.videoId,
        durationSeconds,
      });
    } catch (e) {
      setStep(code, { step: "error", error: e instanceof Error ? e.message : "Failed." });
    }
  }

  async function onGenerate() {
    if (!canGenerate || !selectedAvatar) return;
    setBatchError(null);

    // Apply the look ONCE (kontext edit, cached) before the per-language loop,
    // so the edited image drives every video. If no look is selected, use the
    // chosen/uploaded base photo directly (falls back to avatar's photo[0]).
    let lookUrl: string | null = baseImageUrl;
    if (hasLookSelection) {
      try {
        lookUrl = lookReady ? lookImageUrl : await applyLook();
      } catch {
        setBatchError("Could not apply the selected look. Adjust it and try again.");
        return;
      }
    }

    setPhase("running");
    const jobId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`;
    setProgress(languages.map((code) => ({ code, step: "queued" })));

    // Sequential per language (one generation each — important for cost).
    for (const code of languages) {
      await runLanguage(code, jobId, lookUrl);
    }
    setPhase("results");
  }

  function reset() {
    setPhase("form");
    setProgress([]);
    setSuggestion(null);
    setBatchError(null);
  }

  // -------------------------------------------------------------------------
  // RESULTS / RUNNING view
  // -------------------------------------------------------------------------
  if (phase !== "form") {
    return (
      <div className="studio-grid">
        <div className="studio-col">
          <section className="card">
            <h2>Progreso de generación</h2>
            <p className="muted small">
              {selectedAvatar?.name} · {aspectRatio} · {languages.length}{" "}
              {languages.length === 1 ? "idioma" : "idiomas"}
            </p>
            <ul className="progress-list">
              {progress.map((p) => {
                const lang = studioLanguage(p.code);
                const label =
                  p.step === "translating"
                    ? `Traduciendo a ${lang?.label}…`
                    : p.step === "video" && p.note
                      ? `${STEP_LABEL.video} (${p.note})`
                      : STEP_LABEL[p.step];
                return (
                  <li key={p.code} className={`progress-item step-${p.step}`}>
                    <span className="progress-lang">{lang?.label}</span>
                    <span className="progress-step">
                      {p.step === "error" ? p.error ?? "Error" : label}
                    </span>
                  </li>
                );
              })}
            </ul>
            {phase === "results" ? (
              <button type="button" onClick={reset} style={{ marginTop: 16 }}>
                Generar otro
              </button>
            ) : (
              <p className="muted small" style={{ marginTop: 12 }}>
                Esto puede tardar entre 30 y 90 segundos por vídeo (a veces más).
                Mantén esta pestaña abierta — sigue trabajando.
              </p>
            )}
            {batchError ? <p className="error">{batchError}</p> : null}
          </section>
        </div>

        <div className="studio-col">
          <section className="card">
            <h2>Resultados</h2>
            {results.length === 0 ? (
              <p className="muted">Los vídeos aparecerán aquí a medida que terminen.</p>
            ) : (
              <div className="results-list">
                {results.map((r) => {
                  const lang = studioLanguage(r.code);
                  return (
                    <div key={r.code} className="result-item">
                      <div className="result-meta">
                        <strong>{lang?.label}</strong>
                        <span className="muted small">
                          {selectedAvatar?.name} · {aspectRatio} ·{" "}
                          ~{r.durationSeconds}s
                        </span>
                      </div>
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video controls src={r.videoUrl} className="result-video" />
                      <a
                        href={r.videoUrl}
                        download={`${selectedAvatar?.name ?? "video"}_${r.code}.mp4`}
                      >
                        <button className="secondary" type="button">
                          Descargar
                        </button>
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // FORM view
  // -------------------------------------------------------------------------
  return (
    <div className="studio-grid">
      <div className="studio-col">
        {/* STEP 1 — avatar */}
        <section className="card">
          <h2><span className="step-n">1</span>Elige el avatar</h2>
          <div className="avatar-cards">
            {avatars.map((a) => {
              const disabled = !a.hasVoice;
              const selected = a.id === avatarId;
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`avatar-card${selected ? " selected" : ""}`}
                  disabled={disabled}
                  onClick={() => selectAvatar(a)}
                >
                  {a.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.thumbnailUrl} alt={a.name} className="avatar-thumb" />
                  ) : (
                    <div className="avatar-thumb placeholder" />
                  )}
                  <div className="avatar-card-name">{a.name}</div>
                  {disabled ? <div className="muted small">Clona la voz primero</div> : null}
                </button>
              );
            })}
          </div>

          {selectedAvatar ? (
            <div className="photo-picker">
              <label className="small" style={{ display: "block", margin: "12px 0 6px" }}>
                Foto para este video
              </label>
              <div className="photo-options">
                {selectedAvatar.photos.map((p) => (
                  <button
                    key={p.path}
                    type="button"
                    className={`photo-option${baseImagePath === p.path ? " selected" : ""}`}
                    onClick={() => chooseExistingPhoto(p.path, p.url)}
                    title="Usar esta foto"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="Foto del avatar" />
                  </button>
                ))}

                <label className={`photo-option upload${uploadingPhoto ? " busy" : ""}`}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    style={{ display: "none" }}
                    disabled={uploadingPhoto}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadNewPhoto(f);
                      e.currentTarget.value = "";
                    }}
                  />
                  <span>{uploadingPhoto ? "Subiendo…" : "+ Subir foto"}</span>
                </label>
              </div>
              <p className="muted small" style={{ marginTop: 6 }}>
                La foto subida se usa solo para este video; no se guarda en el avatar.
                Usá una foto frontal y nítida para mejor calidad.
              </p>
              {photoError ? <p className="error">{photoError}</p> : null}
            </div>
          ) : null}
        </section>

        {/* STEP 2 — script */}
        <section className="card">
          <h2><span className="step-n">2</span>Escribe el guion</h2>
          <textarea
            rows={5}
            value={script}
            onChange={(e) => {
              setScript(e.target.value);
              setSuggestion(null);
            }}
            placeholder="Escribe lo que dirá el avatar…"
          />
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted small">
              {charCount} caracteres · ~{estSeconds}s
            </span>
            <button
              type="button"
              className="secondary"
              onClick={onImprove}
              disabled={improving || !script.trim()}
            >
              {improving ? "Mejorando…" : "✨ Mejorar con IA"}
            </button>
          </div>
          {improveError ? <p className="error">{improveError}</p> : null}
          {suggestion ? (
            <div className="suggestion">
              <p className="muted small" style={{ marginTop: 0 }}>Sugerencia de IA:</p>
              <p>{suggestion}</p>
              <div className="row">
                <button
                  type="button"
                  onClick={() => {
                    setScript(suggestion);
                    setSuggestion(null);
                  }}
                >
                  Aceptar
                </button>
                <button type="button" className="secondary" onClick={() => setSuggestion(null)}>
                  Descartar
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {/* STEP 3 — languages */}
        <section className="card">
          <h2><span className="step-n">3</span>Idiomas</h2>
          <div className="chips">
            {STUDIO_LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                className={`chip${languages.includes(l.code) ? " active" : ""}`}
                onClick={() => toggleLanguage(l.code)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="muted small">
            {languages.length} {languages.length === 1 ? "idioma seleccionado" : "idiomas seleccionados"} ·
            genera {languages.length} {languages.length === 1 ? "vídeo" : "vídeos"}
          </p>
          <p className="muted small">
            Tu guion se traducirá y se hablará en cada idioma con la voz clonada.
          </p>
        </section>

        {/* STEP 4 — look (wardrobe + background presets) */}
        <section className="card">
          <h2><span className="step-n">4</span>Apariencia</h2>
          {!selectedAvatar ? (
            <p className="muted small">Elige un avatar para definir su apariencia.</p>
          ) : (
            <>
              <div className="look-mode-toggle" style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <button
                  type="button"
                  className={lookMode === "preset" ? "secondary active" : "secondary"}
                  onClick={() => {
                    setLookMode("preset");
                    setLookError(null);
                  }}
                  aria-pressed={lookMode === "preset"}
                >
                  Presets
                </button>
                <button
                  type="button"
                  className={lookMode === "free" ? "secondary active" : "secondary"}
                  onClick={() => {
                    setLookMode("free");
                    setLookError(null);
                  }}
                  aria-pressed={lookMode === "free"}
                >
                  Descripción libre
                </button>
              </div>

              {lookMode === "preset" ? (
                <>
                  <label htmlFor="wardrobe">Vestuario</label>
                  <select
                    id="wardrobe"
                    value={wardrobeId}
                    onChange={(e) => {
                      setWardrobeId(e.target.value);
                      setLookError(null);
                    }}
                  >
                    <option value="">— ninguno —</option>
                    {selectedAvatar.wardrobe.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="background">Fondo</label>
                  <select
                    id="background"
                    value={backgroundId}
                    onChange={(e) => {
                      setBackgroundId(e.target.value);
                      setLookError(null);
                    }}
                  >
                    <option value="">— ninguno —</option>
                    {selectedAvatar.background.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>

                  <p className="muted small">
                    Presets predefinidos. La apariencia se aplica a la imagen del
                    avatar antes del vídeo — elige uno de cada y previsualiza.
                  </p>
                </>
              ) : (
                <>
                  <label htmlFor="freePrompt">Describe la apariencia</label>
                  <textarea
                    id="freePrompt"
                    value={freePrompt}
                    maxLength={600}
                    rows={3}
                    placeholder="Ej: saco azul marino sobre camisa blanca, en una oficina moderna con luz cálida y ventanales al fondo"
                    onChange={(e) => {
                      setFreePrompt(e.target.value);
                      setLookError(null);
                    }}
                  />
                  <p className="muted small">
                    Describe ropa y escenario en una sola frase. La cara y la
                    identidad del avatar se mantienen. {trimmedFreePrompt.length}/600
                  </p>
                </>
              )}

              <button
                type="button"
                className="secondary"
                onClick={() => {
                  applyLook().catch(() => {});
                }}
                disabled={!hasLookSelection || applyingLook}
              >
                {applyingLook
                  ? "Aplicando apariencia…"
                  : lookReady
                    ? "Apariencia aplicada ✓ — volver a previsualizar"
                    : "Previsualizar apariencia"}
              </button>
              {lookError ? <p className="error">{lookError}</p> : null}
            </>
          )}
        </section>

        {/* On-screen text step PARKED (removed): ffmpeg burn doesn't run in
            Vercel serverless and a burned-in mark isn't acceptable for Eolax's
            own-brand content. May return via a non-serverless approach. */}

        {/* STEP 5 — format */}
        <section className="card">
          <h2><span className="step-n">5</span>Formato</h2>
          <div className="chips">
            {ASPECT_RATIOS.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`chip${aspectRatio === r.value ? " active" : ""}`}
                onClick={() => setAspectRatio(r.value)}
              >
                {r.label} <span className="muted small">· {r.hint}</span>
              </button>
            ))}
          </div>
          <p className="muted small">
            Un formato por lote — se usa el mismo para todos los idiomas elegidos.
          </p>
        </section>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted small">Saldo de créditos</span>
            <span className="small">
              <strong>{balanceSeconds}s</strong> disponibles
            </span>
          </div>
          {languages.length > 0 ? (
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted small">
                Coste estimado ({languages.length} × {estSeconds}s)
              </span>
              <span className="small">~{estimatedCost}s</span>
            </div>
          ) : null}
          <p className="muted small" style={{ margin: "6px 0 0" }}>
            Cada vídeo completado (incluidas las regeneraciones) descuenta su
            duración real.
          </p>
        </div>

        <button type="button" onClick={onGenerate} disabled={!canGenerate}>
          Generar {languages.length > 0 ? `${languages.length} ` : ""}
          {languages.length === 1 ? "vídeo" : "vídeos"}
        </button>
        {!selectedAvatar ? (
          <p className="muted small">Elige un avatar para empezar.</p>
        ) : !selectedAvatar.hasVoice ? (
          <p className="muted small">Este avatar no tiene voz clonada.</p>
        ) : charCount > 0 && languages.length > 0 && !enoughCredits ? (
          <p className="error">
            Créditos insuficientes — se necesitan {estimatedCost}s y hay{" "}
            {balanceSeconds}s disponibles. Contacta con MTS para recargar.
          </p>
        ) : null}
      </div>

      <div className="studio-col">
        <section className="card">
          <h2>Vista previa</h2>
          {lookReady && lookImageUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={lookImageUrl} alt="Apariencia aplicada" className="preview-image" />
              <p className="ok small">✓ Apariencia aplicada — esta imagen genera el vídeo.</p>
            </>
          ) : baseImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={baseImageUrl}
              alt={selectedAvatar?.name ?? "Avatar"}
              className="preview-image"
            />
          ) : (
            <p className="muted">Elige un avatar para previsualizar su rostro.</p>
          )}
          {selectedAvatar ? (
            <p className="muted small">
              {selectedAvatar.name} aporta el rostro y la voz clonada en cada
              vídeo generado.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
