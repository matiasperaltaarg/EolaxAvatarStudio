// Shared avatar types and constants used across pages and server actions.

export type AvatarStatus = "draft" | "active";

export type Avatar = {
  id: string;
  account_id: string;
  name: string;
  status: AvatarStatus;
  reference_photos: string[];
  elevenlabs_voice_id: string | null;
  rights_confirmed: boolean;
  default_language: string;
  personality_editable: string | null;
  voice_reference_paths: string[];
  created_at: string;
};

export const REFERENCE_PHOTOS_BUCKET = "avatar-reference-photos";
export const VOICE_REFERENCES_BUCKET = "avatar-voice-references";
export const GENERATED_CONTENT_BUCKET = "generated-content";

// Studio languages for video generation (CLAUDE.md ES/EN/PT/IT + FR/DE).
// `english` is used in the LLM translation prompt; `label` is shown in the UI.
export const STUDIO_LANGUAGES: { code: string; label: string; english: string }[] = [
  { code: "es", label: "Español", english: "Spanish" },
  { code: "en", label: "English", english: "English" },
  { code: "pt", label: "Português", english: "Portuguese" },
  { code: "it", label: "Italiano", english: "Italian" },
  { code: "fr", label: "Français", english: "French" },
  { code: "de", label: "Deutsch", english: "German" },
];

export function studioLanguage(code: string) {
  return STUDIO_LANGUAGES.find((l) => l.code === code);
}

export const ASPECT_RATIOS: { value: string; label: string; hint: string }[] = [
  { value: "9:16", label: "9:16 Vertical", hint: "Reels / TikTok" },
  { value: "1:1", label: "1:1 Square", hint: "Feed" },
  { value: "16:9", label: "16:9 Horizontal", hint: "YouTube" },
];

// Rough guide used for the script duration estimate and TTS duration column.
export const CHARS_PER_SECOND = 14;

export function estimateDurationSeconds(text: string): number {
  return Math.max(1, Math.round(text.trim().length / CHARS_PER_SECOND));
}

// Localised default test phrases so the preview actually speaks the chosen
// language (eleven_multilingual_v2 detects language from the input text).
export const VOICE_TEST_PHRASES: Record<string, string> = {
  es: "Hola, soy la voz de este avatar. Esto es una prueba.",
  en: "Hello, this is the voice of this avatar. This is a test.",
  pt: "Olá, esta é a voz deste avatar. Isto é um teste.",
  it: "Ciao, questa è la voce di questo avatar. Questa è una prova.",
};

// ES/EN/PT/IT to start (CLAUDE.md §4).
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "es", label: "Spanish" },
  { code: "en", label: "English" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
];

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();
}
