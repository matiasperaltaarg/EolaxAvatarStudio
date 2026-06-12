import { NextResponse, type NextRequest } from "next/server";
import { authedContext } from "@/lib/studio-auth";
import { REFERENCE_PHOTOS_BUCKET } from "@/lib/avatars";
import { fuseFaceAndBody } from "@/lib/replicate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/studio/fuse  { avatarId, bodyPath, facePath }
// Fuses a high-fidelity FACE photo onto a BODY/POSE photo (both already uploaded
// to Storage by the browser) so the talking-head video keeps the real person's
// likeness on a full-body shot. Returns a signed URL + the stored path of the
// fused image, which the Studio then uses as the video's base photo.
export async function POST(request: NextRequest) {
  const ctx = await authedContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

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

  // Only accept paths inside this account+avatar prefix (anti-traversal).
  const prefix = `${ctx.accountId}/${avatarId}/`;
  if (!bodyPath.startsWith(prefix) || !facePath.startsWith(prefix)) {
    return NextResponse.json({ error: "Invalid photo paths." }, { status: 400 });
  }

  // Verify the avatar belongs to this account.
  const { data: avatar } = await ctx.supabase
    .from("avatars")
    .select("id")
    .eq("id", avatarId)
    .eq("account_id", ctx.accountId)
    .single();
  if (!avatar) return NextResponse.json({ error: "Avatar not found." }, { status: 404 });

  try {
    // Sign both uploaded photos so Replicate can read them.
    const [bodySigned, faceSigned] = await Promise.all([
      ctx.supabase.storage.from(REFERENCE_PHOTOS_BUCKET).createSignedUrl(bodyPath, 3600),
      ctx.supabase.storage.from(REFERENCE_PHOTOS_BUCKET).createSignedUrl(facePath, 3600),
    ]);
    if (!bodySigned.data?.signedUrl || !faceSigned.data?.signedUrl) {
      throw new Error("Could not read the uploaded photos.");
    }

    // Fuse face onto body via multi-image kontext.
    const fusedUrl = await fuseFaceAndBody({
      bodyUrl: bodySigned.data.signedUrl,
      faceUrl: faceSigned.data.signedUrl,
    });

    // Download the fused image and store it for this video (not saved to avatar).
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
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
