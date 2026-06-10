import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { studioLanguage } from "@/lib/avatars";
import { translateScript } from "@/lib/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/studio/translate  { text, language }
// Translates the script into the target language (preserving tone/length).
export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { text, language } = (await request.json().catch(() => ({}))) as {
    text?: string;
    language?: string;
  };
  if (!text?.trim()) {
    return NextResponse.json({ error: "No script text to translate." }, { status: 400 });
  }
  const lang = studioLanguage(language ?? "");
  if (!lang) {
    return NextResponse.json({ error: "Unknown language." }, { status: 400 });
  }

  try {
    const translated = await translateScript(text, lang.english);
    return NextResponse.json({ text: translated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Translation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
