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
};

type StepKey = "queued" | "translating" | "voice" | "video" | "done" | "error";

type LangProgress = {
  code: string;
  step: StepKey;
  error?: string;
  videoUrl?: string;
  videoId?: string;
  durationSeconds?: number;
};

const STEP_LABEL: Record<StepKey, string> = {
  queued: "Queued…",
  translating: "Translating…",
  voice: "Generating voice…",
  video: "Creating video with lip-sync…",
  done: "Done ✓",
  error: "Failed",
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function Studio({ avatars }: { avatars: StudioAvatar[] }) {
  const [phase, setPhase] = useState<"form" | "running" | "results">("form");

  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [improving, setImproving] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState("9:16");

  const [progress, setProgress] = useState<LangProgress[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);

  const selectedAvatar = avatars.find((a) => a.id === avatarId) ?? null;
  const charCount = script.trim().length;
  const estSeconds = estimateDurationSeconds(script);

  const canGenerate =
    Boolean(selectedAvatar?.hasVoice) && charCount > 0 && languages.length > 0;

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

  async function runLanguage(code: string, jobId: string) {
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

      // c) Video (start + poll).
      setStep(code, { step: "video" });
      const sRes = await fetch("/api/studio/video/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarId: avatar.id, audioUrl }),
      });
      const sJson = await sRes.json();
      if (!sRes.ok) throw new Error(`Video: ${sJson.error}`);
      const predictionId: string = sJson.predictionId;

      let finishedVideoUrl: string | null = null;
      for (let i = 0; i < 200; i++) {
        await sleep(4000);
        const pRes = await fetch(`/api/studio/video/status?id=${encodeURIComponent(predictionId)}`);
        const pJson = await pRes.json();
        if (!pRes.ok) throw new Error(`Video: ${pJson.error}`);
        if (pJson.status === "succeeded") {
          finishedVideoUrl = pJson.videoUrl;
          break;
        }
        if (pJson.status === "failed" || pJson.status === "canceled") {
          throw new Error(`Video: lip-sync ${pJson.status}${pJson.error ? ` — ${pJson.error}` : ""}`);
        }
      }
      if (!finishedVideoUrl) throw new Error("Video: timed out waiting for the result.");

      // d) Finalize (download → store → DB row).
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
    setPhase("running");
    const jobId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`;
    setProgress(languages.map((code) => ({ code, step: "queued" })));

    // Sequential per language (one generation each — important for cost).
    for (const code of languages) {
      await runLanguage(code, jobId);
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
            <h2>Generation progress</h2>
            <p className="muted small">
              {selectedAvatar?.name} · {aspectRatio} · {languages.length}{" "}
              language{languages.length === 1 ? "" : "s"}
            </p>
            <ul className="progress-list">
              {progress.map((p) => {
                const lang = studioLanguage(p.code);
                const label =
                  p.step === "translating"
                    ? `Translating to ${lang?.label}…`
                    : STEP_LABEL[p.step];
                return (
                  <li key={p.code} className={`progress-item step-${p.step}`}>
                    <span className="progress-lang">{lang?.label}</span>
                    <span className="progress-step">
                      {p.step === "error" ? p.error ?? "Failed" : label}
                    </span>
                  </li>
                );
              })}
            </ul>
            {phase === "results" ? (
              <button type="button" onClick={reset} style={{ marginTop: 16 }}>
                Generate another
              </button>
            ) : (
              <p className="muted small" style={{ marginTop: 12 }}>
                This can take 30–90 seconds per video. Keep this tab open.
              </p>
            )}
            {batchError ? <p className="error">{batchError}</p> : null}
          </section>
        </div>

        <div className="studio-col">
          <section className="card">
            <h2>Results</h2>
            {results.length === 0 ? (
              <p className="muted">Videos will appear here as each one finishes.</p>
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
                          Download
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
          <h2>1 · Select avatar</h2>
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
                  onClick={() => setAvatarId(a.id)}
                >
                  {a.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.thumbnailUrl} alt={a.name} className="avatar-thumb" />
                  ) : (
                    <div className="avatar-thumb placeholder" />
                  )}
                  <div className="avatar-card-name">{a.name}</div>
                  {disabled ? <div className="muted small">Clone voice first</div> : null}
                </button>
              );
            })}
          </div>
        </section>

        {/* STEP 2 — script */}
        <section className="card">
          <h2>2 · Write the script</h2>
          <textarea
            rows={5}
            value={script}
            onChange={(e) => {
              setScript(e.target.value);
              setSuggestion(null);
            }}
            placeholder="Write what the avatar should say…"
          />
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted small">
              {charCount} chars · ~{estSeconds}s
            </span>
            <button
              type="button"
              className="secondary"
              onClick={onImprove}
              disabled={improving || !script.trim()}
            >
              {improving ? "Improving…" : "✨ Improve with AI"}
            </button>
          </div>
          {improveError ? <p className="error">{improveError}</p> : null}
          {suggestion ? (
            <div className="suggestion">
              <p className="muted small" style={{ marginTop: 0 }}>AI suggestion:</p>
              <p>{suggestion}</p>
              <div className="row">
                <button
                  type="button"
                  onClick={() => {
                    setScript(suggestion);
                    setSuggestion(null);
                  }}
                >
                  Accept
                </button>
                <button type="button" className="secondary" onClick={() => setSuggestion(null)}>
                  Reject
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {/* STEP 3 — languages */}
        <section className="card">
          <h2>3 · Languages</h2>
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
            {languages.length} language{languages.length === 1 ? "" : "s"} selected ·
            generates {languages.length} video{languages.length === 1 ? "" : "s"}
          </p>
          <p className="muted small">
            Your script will be translated and spoken in each language with the
            cloned voice.
          </p>
        </section>

        {/* STEP 4 — format */}
        <section className="card">
          <h2>4 · Format</h2>
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
            One format per batch — the same format is used for all selected
            languages.
          </p>
        </section>

        <button type="button" onClick={onGenerate} disabled={!canGenerate}>
          Generate {languages.length > 0 ? `${languages.length} ` : ""}video
          {languages.length === 1 ? "" : "s"}
        </button>
        {!selectedAvatar ? (
          <p className="muted small">Select an avatar to begin.</p>
        ) : !selectedAvatar.hasVoice ? (
          <p className="muted small">This avatar has no cloned voice.</p>
        ) : null}
      </div>

      <div className="studio-col">
        <section className="card">
          <h2>Preview</h2>
          {selectedAvatar?.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedAvatar.thumbnailUrl}
              alt={selectedAvatar.name}
              className="preview-image"
            />
          ) : (
            <p className="muted">Select an avatar to preview its face.</p>
          )}
          {selectedAvatar ? (
            <p className="muted small">
              {selectedAvatar.name} drives the face and the cloned voice for
              every generated video.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
