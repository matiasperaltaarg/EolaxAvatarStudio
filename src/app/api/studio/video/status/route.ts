import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { getInfiniteTalkResult } from "@/lib/wavespeed";
import { createAdminClient } from "@/lib/supabase/admin";
import { atomicDebitForVideo, secondsToCharge } from "@/lib/credits";
import { logApiUsage } from "@/lib/usageLog";

export const dynamic = "force-dynamic";

// GET /api/studio/video/status?id=<predictionId>&seconds=<durationSeconds>
// Polls the WaveSpeed task. When the video first reaches "succeeded", debits
// the video credits ONCE (atomic + idempotent per prediction id), so the client
// polling repeatedly never double-charges. Returns the same result shape plus
// `charged`/`secondsCharged` for transparency.
export async function GET(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing prediction id." }, { status: 400 });

  // Duration to charge if the video is complete. The client sends the same
  // durationSeconds it used to start the video. Fallback to 0 → secondsToCharge
  // floors at 1s, so a completed video always costs at least 1s.
  const secondsParam = request.nextUrl.searchParams.get("seconds");
  const durationSeconds = secondsParam ? Number(secondsParam) : undefined;

  try {
    const result = await getInfiniteTalkResult(id);

    // Debit only on success. atomicDebitForVideo is idempotent per videoId
    // (the prediction id): the unique generations_log row means repeated polls
    // after "succeeded" do not charge again.
    let charged = false;
    let secondsCharged = 0;
    if (result.status === "succeeded") {
      const admin = createAdminClient();
      const seconds = secondsToCharge(durationSeconds);
      try {
        const debit = await atomicDebitForVideo(admin, ctx.accountId, id, seconds);
        charged = debit.charged;
        secondsCharged = debit.secondsCharged;
        await logApiUsage(admin, {
          accountId: ctx.accountId,
          provider: "credits",
          route: "video/status:debit",
          costUsdEst: 0,
          // Not an error path: a skipped debit just means it was already charged
          // (idempotent re-poll) or there was no balance — recorded as a note.
          status: "ok",
          errorMsg: charged ? undefined : "already charged or insufficient",
        });
      } catch (debitErr) {
        // Never fail the status poll because of a debit hiccup — log and move on.
        // The next successful poll will retry the (idempotent) debit.
        const msg = debitErr instanceof Error ? debitErr.message : "debit error";
        console.error(`[video/status] debit failed for ${id}: ${msg}`);
        await logApiUsage(admin, {
          accountId: ctx.accountId,
          provider: "credits",
          route: "video/status:debit",
          costUsdEst: 0,
          status: "error",
          errorMsg: msg.slice(0, 500),
        });
      }
    }

    return NextResponse.json({ ...result, charged, secondsCharged });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not check video status.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
