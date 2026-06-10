import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { getInfiniteTalkResult } from "@/lib/wavespeed";

export const dynamic = "force-dynamic";

// GET /api/studio/video/status?id=<predictionId>
// Lightweight poll of the WaveSpeed task. The client calls this every few
// seconds until status is "succeeded" or "failed".
export async function GET(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing prediction id." }, { status: 400 });

  try {
    const result = await getInfiniteTalkResult(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not check video status.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
