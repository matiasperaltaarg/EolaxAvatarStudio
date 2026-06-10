"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const data = new FormData(formEl);
    const files = data.getAll("audio").filter((f) => f instanceof File && f.size > 0);
    if (files.length === 0) {
      setStatus("error");
      setMessage("Elige al menos un archivo de audio.");
      return;
    }

    setStatus("cloning");
    setMessage(null);
    try {
      const res = await fetch(`/api/avatars/${avatarId}/voice/clone`, {
        method: "POST",
        body: data,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Voice cloning failed.");
      }
      setVoiceId(json.voice_id);
      setStatus("done");
      setMessage(null);
      formEl.reset();
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Voice cloning failed.");
    }
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
        Sube audio de referencia limpio (mp3 / wav / m4a).{" "}
        <strong>~30 segundos o más</strong> de audio claro y de una sola persona
        dan una mejor clonación. Volver a subir reemplaza la voz existente.
      </p>

      <form onSubmit={onSubmit}>
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

      {status === "error" && message ? <p className="error">{message}</p> : null}
      {status === "done" ? <p className="ok">Voz clonada correctamente.</p> : null}
    </section>
  );
}
