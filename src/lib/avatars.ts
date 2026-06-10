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
