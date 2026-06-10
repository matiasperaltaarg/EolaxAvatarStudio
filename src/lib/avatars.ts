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
  created_at: string;
};

export const REFERENCE_PHOTOS_BUCKET = "avatar-reference-photos";

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
