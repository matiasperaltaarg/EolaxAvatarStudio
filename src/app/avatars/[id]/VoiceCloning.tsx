"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import VoiceRecorder from "./VoiceRecorder";

type Props = {
  avatarId: string;
  hasRights: boolean;
  existingVoiceId: string | null;
};

export default function VoiceCloning({ avatarId, hasRights, existingVoiceId }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "cloning" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(existingVoiceId);
  const [mode, setMode] = useState<"record" | "upload">("record");

  if (!hasRights) {
    return (
      <section className="card">
        <h2>Clonación de voz</h2>
        <p className="muted">
          La clonación de voz está bloqueada hasta confirmar los derechos
          firmados de imagen <strong>y voz</strong> de este avatar (ver
          verificación de derechos arriba). No se puede clonar la voz de una
          persona sin derechos confirmados.
        </p>
      </section>
    );
  }

  // Shared clone request: sends an audio sample to the same Add Voice endpoint.
  async function cloneWithData(data: FormData) {
    setStatus("cloning");
    setMessage(null);
    try {
      const res = await fetch(`/api/avatars/${avatarId}/voice/clone`, {
        method: "POST",
        body: data,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo clonar la voz.");
      setVoiceId(json.voice_id);
      setStatus("done");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "No se pudo clonar la voz.");
    }
  }

  function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const files = data.getAll("audio").filter((f) => f instanceof File && f.size > 0);
    if (files.length === 0) {
      setStatus("error");
      setMessage("Elige al menos un archivo de audio.");
      return;
    }
    cloneWithData(data);
  }

  function onRecorded(wav: Blob) {
    const data = new FormData();
    data.append("audio", new File([wav], "grabacion.wav", { type: "audio/wav" }));
    cloneWithData(data);
  }

  return (
    <section className="card">
      <h2>Clonación de voz</h2>

      {voiceId ? (
        <p className="ok">
          ✓ Voz clonada lista — ID de voz: <code>{voiceId}</code>
        </p>
      ) : (
        <p className="muted">Este avatar aún no tiene voz clonada.</p>
      )}

      <p className="muted small">
        Recomendado: <strong>grabar en la app</strong>. Los audios de WhatsApp
        suenan robóticos al clonar por la compresión. Volver a grabar o subir
        reemplaza la voz existente.
      </p>

      <div className="chips" style={{ marginTop: 4 }}>
        <button
          type="button"
          className={`chip${mode === "record" ? " active" : ""}`}
          onClick={() => setMode("record")}
        >
          🎙 Grabar voz
        </button>
        <button
          type="button"
          className={`chip${mode === "upload" ? " active" : ""}`}
          onClick={() => setMode("upload")}
        >
          ⬆ Subir archivo
        </button>
      </div>

      {mode === "record" ? (
        <VoiceRecorder busy={status === "cloning"} onSubmit={onRecorded} />
      ) : (
        <form onSubmit={onUpload}>
          <p className="muted small">
            Sube audio limpio (mp3 / wav / m4a), ~30 s o más, de una sola persona.
            Útil si ya tienes una grabación profesional.
          </p>
          <input
            name="audio"
            type="file"
            accept="audio/mpeg,audio/wav,audio/x-m4a,audio/mp4,.mp3,.wav,.m4a"
            multiple
            required
            disabled={status === "cloning"}
          />
          <button type="submit" disabled={status === "cloning"}>
            {status === "cloning"
              ? "Clonando voz…"
              : voiceId
                ? "Volver a subir y reclonar voz"
                : "Subir y clonar voz"}
          </button>
        </form>
      )}

      {status === "error" && message ? <p className="error" style={{ marginTop: 10 }}>{message}</p> : null}
      {status === "done" ? <p className="ok" style={{ marginTop: 10 }}>Voz clonada correctamente.</p> : null}
    </section>
  );
}
