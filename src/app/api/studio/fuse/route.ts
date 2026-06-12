import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { REFERENCE_PHOTOS_BUCKET } from "@/lib/avatars";
import { fuseFaceAndBody } from "@/lib/replicate";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { logApiUsage } from "@/lib/usageLog";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const admin = createAdminClient();

  const rl = await checkRateLimit(admin, ctx.accountId, "fuse", { perMinute: 10 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes de fusión. Intenta en un minuto." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const { avatarId, bodyPath, facePath } = (await request.json().catch(() => ({}))) as {
    avatarId?: string;
    bodyPath?: string;
    facePath?: string;
  };

  if (!avatarId || !bodyPath || !facePath) {
    return NextResponse.json(
      { error: "Missing avatar, body photo or face photo." },
      { status: 400 }
    );
  }

  const prefix = `${ctx.accountId}/${avatarId}/`;
  if (!bodyPath.startsWith(prefix) || !facePath.startsWith(prefix)) {
    return NextResponse.json({ error: "Invalid photo paths." }, { status: 400 });
  }

  const { data: avatar } = await ctx.supabase
    .from("avatars")
    .select("id")
    .eq("id", avatarId)
    .eq("account_id", ctx.accountId)
    .single();
  if (!avatar) return NextResponse.json({ error: "Avatar not found." }, { status: 404 });

  try {
    const [bodySigned, faceSigned] = await Promise.all([
      ctx.supabase.storage.from(REFERENCE_PHOTOS_BUCKET).createSignedUrl(bodyPath, 3600),
      ctx.supabase.storage.from(REFERENCE_PHOTOS_BUCKET).createSignedUrl(facePath, 3600),
    ]);
    if (!bodySigned.data?.signedUrl || !faceSigned.data?.signedUrl) {
      throw new Error("Could not read the uploaded photos.");
    }

    const fusedUrl = await fuseFaceAndBody({
      bodyUrl: bodySigned.data.signedUrl,
      faceUrl: faceSigned.data.signedUrl,
    });

    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "replicate",
      route: "fuse",
      costUsdEst: 0.03,
      status: "ok",
    });

    const imgRes = await fetch(fusedUrl);
    if (!imgRes.ok) throw new Error(`Could not download the fused image (${imgRes.status}).`);
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    const fusedPath = `${ctx.accountId}/${avatarId}/fused/${crypto.randomUUID()}.png`;

    const { error: upErr } = await ctx.supabase.storage
      .from(REFERENCE_PHOTOS_BUCKET)
      .upload(fusedPath, bytes, { contentType: "image/png", upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { data: signed } = await ctx.supabase.storage
      .from(REFERENCE_PHOTOS_BUCKET)
      .createSignedUrl(fusedPath, 3600);

    return NextResponse.json({
      path: fusedPath,
      url: signed?.signedUrl ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Face fusion failed.";
    await logApiUsage(admin, {
      accountId: ctx.accountId,
      provider: "replicate",
      route: "fuse",
      costUsdEst: 0,
      status: "error",
      errorMsg: message.slice(0, 500),
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
