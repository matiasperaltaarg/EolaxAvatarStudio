"use client";

import { useState } from "react";
import { LANGUAGES, VOICE_TEST_PHRASES } from "@/lib/avatars";

type Props = {
  avatarId: string;
  defaultLanguage: string;
};

export default function VoiceTest({ avatarId, defaultLanguage }: Props) {
  const initialLang = VOICE_TEST_PHRASES[defaultLanguage] ? defaultLanguage : "es";
  const [language, setLanguage] = useState(initialLang);
  const [text, setText] = useState(VOICE_TEST_PHRASES[initialLang]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  function onLanguageChange(code: string) {
    setLanguage(code);
    // Swap in the localised default phrase for the chosen language.
    setText(VOICE_TEST_PHRASES[code] ?? text);
  }

  async function onGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/avatars/${avatarId}/voice/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Voice preview failed.");
      }
      const blob = await res.blob();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice preview failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <h2>Test voice</h2>
      <p className="muted small">
        Preview the cloned voice in any language. This is a preview only — no
        credits are charged.
      </p>

      <label htmlFor="vt-language">Language</label>
      <select
        id="vt-language"
        value={language}
        onChange={(e) => onLanguageChange(e.target.value)}
        disabled={loading}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>

      <label htmlFor="vt-text">Test phrase</label>
      <textarea
        id="vt-text"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={loading}
      />

      <button type="button" onClick={onGenerate} disabled={loading || !text.trim()}>
        {loading ? "Generating preview…" : "Generate preview"}
      </button>

      {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}

      {audioUrl ? (
        <div style={{ marginTop: 16 }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={audioUrl} style={{ width: "100%" }} />
        </div>
      ) : null}
    </section>
  );
}
