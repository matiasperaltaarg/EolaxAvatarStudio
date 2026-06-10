import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { improveScript } from "@/lib/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/studio/improve  { script, avatarId }
// Improves the script for social media using the avatar's personality as tone.
export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { script, avatarId } = (await request.json().catch(() => ({}))) as {
    script?: string;
    avatarId?: string;
  };
  if (!script?.trim()) {
    return NextResponse.json({ error: "Write a script first." }, { status: 400 });
  }

  let personality: string | null = null;
  if (avatarId) {
    const { data } = await ctx.supabase
      .from("avatars")
      .select("personality_editable")
      .eq("id", avatarId)
      .eq("account_id", ctx.accountId)
      .single();
    personality = data?.personality_editable ?? null;
  }

  try {
    const improved = await improveScript(script, personality);
    return NextResponse.json({ improved });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Script improvement failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
