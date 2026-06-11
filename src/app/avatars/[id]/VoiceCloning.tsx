"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import VoiceRecorder from "./VoiceRecorder";
import { createClient } from "@/lib/supabase/client";
import { VOICE_REFERENCES_BUCKET } from "@/lib/avatars";

type Props = {
  avatarId: string;
  accountId: string;
  hasRights: boolean;
  existingVoiceId: string | null;
};

export default function VoiceCloning({ avatarId, accountId, hasRights, existingVoiceId }: Props) {
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

  // Upload reference audio files DIRECTLY to Supabase Storage (bypasses the
  // Vercel route body limit), then ask the server to clone from those paths.
  async function cloneFromFiles(files: File[]) {
    setStatus("cloning");
    setMessage(null);
    const supabase = createClient();
    const uploadedPaths: string[] = [];
    try {
      for (const file of files) {
        const dot = file.name.lastIndexOf(".");
        const ext =
          dot >= 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "wav";
        const path = `${accountId}/${avatarId}/${crypto.randomUUID()}.${ext || "wav"}`;
        const { error: upErr } = await supabase.storage
          .from(VOICE_REFERENCES_BUCKET)
          .upload(path, file, {
            contentType: file.type || "audio/wav",
            upsert: false,
          });
        if (upErr) throw new Error(`No se pudo subir el audio: ${upErr.message}`);
        uploadedPaths.push(path);
      }

      const res = await fetch(`/api/avatars/${avatarId}/voice/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePaths: uploadedPaths }),
      });

      const raw = await res.text();
      let json: { error?: string; voice_id?: string } = {};
      try {
        json = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(raw.slice(0, 200) || "Respuesta inesperada del servidor.");
      }
      if (!res.ok) throw new Error(json.error ?? "No se pudo clonar la voz.");

      setVoiceId(json.voice_id!);
      setStatus("done");
      router.refresh();
    } catch (err) {
      // Clean up any uploaded files if the clone failed before the server took over.
      if (uploadedPaths.length > 0) {
        await supabase.storage.from(VOICE_REFERENCES_BUCKET).remove(uploadedPaths).catch(() => {});
      }
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "No se pudo clonar la voz.");
    }
  }

  function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const files = data.getAll("audio").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) {
      setStatus("error");
      setMessage("Elige al menos un archivo de audio.");
      return;
    }
    cloneFromFiles(files);
  }

  function onRecorded(wav: Blob) {
    const file = new File([wav], "grabacion.wav", { type: "audio/wav" });
    cloneFromFiles([file]);
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
