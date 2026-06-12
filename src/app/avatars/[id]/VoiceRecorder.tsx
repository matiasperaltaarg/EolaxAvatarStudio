"use client";

import { useEffect, useRef, useState } from "react";
import { blobToCleanWav } from "./wav";

// Guided ~60-90s Spanish script: phonetically varied (rr, ñ, vowels, numbers),
// natural and neutral, so the clone captures a broad range of sounds.
const SCRIPT = `Hola, gracias por tomarte un momento para grabar esta muestra de voz. Habla con naturalidad, como si conversaras con un amigo, sin prisa y con buena entonación.

El veloz murciélago hindú comía feliz cardillo y kiwi mientras una cigüeña tocaba el saxofón detrás del palenque de paja. Las jirafas y los pingüinos observaban el cielo azul esperando que la lluvia refrescara el jardín.

Quiero pronunciar con claridad las erres, como en perro, carretera y ferrocarril, y también las eñes, como en niño, España y montaña. Conté del uno al diez: uno, dos, tres, cuatro, cinco, seis, siete, ocho, nueve y diez.

Si lees este párrafo completo, despacio y con tu tono habitual, la grabación tendrá la duración suficiente para clonar la voz con buena calidad. Gracias de nuevo por tu colaboración.`;

const MIN_SECONDS = 45;
const QUIET_PEAK = 0.05; // below this, warn that it's too quiet

type Props = {
  busy: boolean;
  onSubmit: (wav: Blob) => void;
};

export default function VoiceRecorder({ busy, onSubmit }: Props) {
  const [phase, setPhase] = useState<"idle" | "recording" | "recorded" | "preparing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedRef = useRef<Blob | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    setError(null);
    setWarn(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        recordedRef.current = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
        if (playbackUrl) URL.revokeObjectURL(playbackUrl);
        setPlaybackUrl(URL.createObjectURL(recordedRef.current));
        setPhase("recorded");
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setSeconds(0);
      setPhase("recording");
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("No se pudo acceder al micrófono. Da permiso al navegador e inténtalo de nuevo.");
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function reRecord() {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    setPlaybackUrl(null);
    recordedRef.current = null;
    setSeconds(0);
    setWarn(null);
    setError(null);
    setPhase("idle");
  }

  async function submit() {
    if (!recordedRef.current) return;
    setPhase("preparing");
    setError(null);
    setWarn(null);
    try {
      const { wav, durationSeconds, peak } = await blobToCleanWav(recordedRef.current);
      if (durationSeconds < MIN_SECONDS) {
        setError(`La grabación es demasiado corta (${Math.round(durationSeconds)}s). Graba al menos ${MIN_SECONDS}s.`);
        setPhase("recorded");
        return;
      }
      if (peak < QUIET_PEAK) {
        setWarn("El audio suena muy bajo. Acércate al micrófono y vuelve a grabar para mejor calidad.");
      }
      onSubmit(wav); // parent runs the clone request
    } catch {
      setError("No se pudo procesar el audio grabado. Vuelve a grabar.");
      setPhase("recorded");
    }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const longEnough = seconds >= MIN_SECONDS;

  return (
    <div>
      <p className="muted small">
        Busca una sala silenciosa, habla cerca del micrófono, evita el eco y lee
        el guion completo con naturalidad. Mínimo recomendado: {MIN_SECONDS}s.
      </p>
      <p className="muted small">
        <b>Importante para el acento:</b> hablá con tu acento natural y tu ritmo
        habitual. El clon imita exactamente cómo hablás en esta grabación, así que
        si querés conservar tu acento (rioplatense, colombiano, etc.), pronunciá
        con naturalidad sin "neutralizar". Variá la entonación: incluí una frase
        animada y una más calmada para que el clon capte tu rango.
      </p>

      <div className="record-script">{SCRIPT}</div>

      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {phase === "idle" ? (
          <button type="button" onClick={start} disabled={busy}>
            ● Grabar
          </button>
        ) : null}

        {phase === "recording" ? (
          <>
            <button type="button" className="danger-btn" onClick={stop}>
              ■ Detener
            </button>
            <span className="record-timer recording">● {mm}:{ss}</span>
          </>
        ) : null}

        {phase === "recorded" || phase === "preparing" ? (
          <>
            <span className="record-timer">⏱ {mm}:{ss}</span>
            <button type="button" className="secondary" onClick={reRecord} disabled={busy || phase === "preparing"}>
              Volver a grabar
            </button>
            <button type="button" onClick={submit} disabled={busy || phase === "preparing" || !longEnough}>
              {phase === "preparing"
                ? "Preparando audio…"
                : busy
                  ? "Clonando voz…"
                  : "Clonar con esta grabación"}
            </button>
          </>
        ) : null}
      </div>

      {phase === "recording" && !longEnough ? (
        <p className="muted small">Sigue leyendo… faltan {MIN_SECONDS - seconds}s para el mínimo.</p>
      ) : null}
      {phase !== "idle" && phase !== "recording" && !longEnough ? (
        <p className="error">La grabación es demasiado corta. Graba al menos {MIN_SECONDS}s.</p>
      ) : null}

      {playbackUrl ? (
        <div style={{ marginTop: 12 }}>
          <p className="muted small" style={{ marginBottom: 4 }}>Escucha antes de enviar:</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={playbackUrl} style={{ width: "100%" }} />
        </div>
      ) : null}

      {warn ? <p className="error" style={{ marginTop: 10 }}>{warn}</p> : null}
      {error ? <p className="error" style={{ marginTop: 10 }}>{error}</p> : null}
    </div>
  );
}
