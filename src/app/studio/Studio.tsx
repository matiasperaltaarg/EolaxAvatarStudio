"use client";

import { useMemo, useState } from "react";
import {
  ASPECT_RATIOS,
  STUDIO_LANGUAGES,
  estimateDurationSeconds,
  studioLanguage,
} from "@/lib/avatars";

export type StudioAvatar = {
  id: string;
  name: string;
  hasVoice: boolean;
  defaultLanguage: string;
  thumbnailUrl: string | null;
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
}: {
  avatars: StudioAvatar[];
  balanceSeconds: number;
}) {
  const [phase, setPhase] = useState<"form" | "running" | "results">("form");

  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [improving, setImproving] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState("9:16");

  // Look (wardrobe + background presets) and on-screen text.
  const [wardrobeId, setWardrobeId] = useState<string>("");
  const [backgroundId, setBackgroundId] = useState<string>("");
  const [overlayText, setOverlayText] = useState("");
  const [lookImageUrl, setLookImageUrl] = useState<string | null>(null);
  const [lookKey, setLookKey] = useState<string>(""); // selection the look image matches
  const [applyingLook, setApplyingLook] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);

  const [progress, setProgress] = useState<LangProgress[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);

  const selectedAvatar = avatars.find((a) => a.id === avatarId) ?? null;
  const charCount = script.trim().length;
  const estSeconds = estimateDurationSeconds(script);

  const hasLookSelection = Boolean(wardrobeId && backgroundId);
  const currentLookKey = `${wardrobeId}|${backgroundId}`;
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
    // Reset the look — presets are per avatar.
    setWardrobeId("");
    setBackgroundId("");
    setLookImageUrl(null);
    setLookKey("");
    setLookError(null);
  }

  async function applyLook(): Promise<string> {
    if (!selectedAvatar || !hasLookSelection) throw new Error("Select a look first.");
    setApplyingLook(true);
    setLookError(null);
    try {
      const res = await fetch("/api/studio/look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatarId: selectedAvatar.id,
          wardrobePresetId: wardrobeId,
          backgroundPresetId: backgroundId,
        }),
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

      // d) Finalize (download → burn overlay → store → DB row).
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
          wardrobePresetId: hasLookSelection ? wardrobeId : null,
          backgroundPresetId: hasLookSelection ? backgroundId : null,
          overlayText: overlayText.trim() || null,
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
    // so the edited image drives every video. Skipped if no look is selected.
    let lookUrl: string | null = null;
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
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <a
                          href={r.videoUrl}
                          download={`${selectedAvatar?.name ?? "video"}_${r.code}.mp4`}
                        >
                          <button className="secondary" type="button">
                            Descargar
                          </button>
                        </a>
                        <span className="ai-note">Contenido generado con IA</span>
                      </div>
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
          <h2>1 · Elige el avatar</h2>
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
        </section>

        {/* STEP 2 — script */}
        <section className="card">
          <h2>2 · Escribe el guion</h2>
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
          <h2>3 · Idiomas</h2>
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
          <h2>4 · Apariencia</h2>
          {!selectedAvatar ? (
            <p className="muted small">Elige un avatar para definir su apariencia.</p>
          ) : selectedAvatar.wardrobe.length === 0 &&
            selectedAvatar.background.length === 0 ? (
            <p className="muted small">
              Este avatar aún no tiene presets. Se usará la foto de referencia original.
            </p>
          ) : (
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
                <option value="">— none —</option>
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
                Solo presets (predefinidos). La apariencia se aplica a la imagen
                del avatar antes del vídeo — elige uno de cada y previsualiza.
              </p>
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

        {/* STEP 5 — on-screen text */}
        <section className="card">
          <h2>5 · Texto en pantalla</h2>
          <input
            type="text"
            value={overlayText}
            onChange={(e) => setOverlayText(e.target.value)}
            placeholder="Texto opcional incrustado en el vídeo"
            maxLength={120}
          />
          <p className="muted small">
            Opcional. Se incrusta en el vídeo final de forma programática (gratis,
            sin IA), con borde para legibilidad y posicionado según el formato.
          </p>
        </section>

        {/* STEP 6 — format */}
        <section className="card">
          <h2>6 · Formato</h2>
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
          ) : selectedAvatar?.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedAvatar.thumbnailUrl}
              alt={selectedAvatar.name}
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
          <p className="ai-note" style={{ marginTop: 10 }}>
            Todos los vídeos llevan la marca “Generado con IA”.
          </p>
        </section>
      </div>
    </div>
  );
}
