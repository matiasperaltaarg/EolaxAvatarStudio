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
        <h2>Voice cloning</h2>
        <p className="muted">
          Voice cloning is blocked until signed image <strong>and voice</strong>{" "}
          rights are confirmed for this avatar (see the legal rights gate above).
          You cannot clone someone&apos;s voice without confirmed rights.
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
      setMessage("Choose at least one audio file.");
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
      <h2>Voice cloning</h2>

      {voiceId ? (
        <p className="ok">
          ✓ Cloned voice ready — voice ID: <code>{voiceId}</code>
        </p>
      ) : (
        <p className="muted">No cloned voice yet for this avatar.</p>
      )}

      <p className="muted small">
        Upload clean reference speech (mp3 / wav / m4a).{" "}
        <strong>~30 seconds or more</strong> of clear, single-speaker audio is
        recommended for a good clone. Re-uploading replaces the existing voice.
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
            ? "Cloning voice…"
            : voiceId
              ? "Re-upload & re-clone voice"
              : "Upload & clone voice"}
        </button>
      </form>

      {status === "error" && message ? <p className="error">{message}</p> : null}
      {status === "done" ? <p className="ok">Voice cloned successfully.</p> : null}
    </section>
  );
}
