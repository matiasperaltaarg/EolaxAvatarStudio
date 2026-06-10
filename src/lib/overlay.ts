// Server-only video mark burner. Uses the self-contained ffmpeg-static binary
// (no system install) + a vendored TTF to burn, in ONE pass:
//   1) the mandatory "Generated with AI" disclosure watermark (every video,
//      not removable by the user), and
//   2) the optional on-screen text caption (Phase 4).
// Both are programmatic (no extra model cost). The disclosure mark is required
// by the rights agreement, so this step is mandatory — callers must treat a
// failure here as a failed generation rather than shipping an unmarked video.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

const FONT_PATH = path.join(process.cwd(), "src/assets/fonts/Roboto-Bold.ttf");

// AI-disclosure text burned into every video. Configurable for future locales.
export const AI_DISCLOSURE_TEXT = process.env.AI_DISCLOSURE_TEXT ?? "Generado con IA";

// Vertical placement of the optional caption per aspect ratio (expression over
// input height `h` and rendered text height `text_h`). Lower third, clear of
// edges and of the bottom watermark zone.
function captionY(aspectRatio: string): string {
  switch (aspectRatio) {
    case "9:16":
      return "h*0.74-text_h/2";
    case "1:1":
      return "h*0.78-text_h/2";
    case "16:9":
    default:
      return "h*0.80-text_h/2";
  }
}

// Burns the AI disclosure mark (always) plus the optional caption. Returns a
// new MP4 buffer. Throws if ffmpeg fails after a retry.
export async function burnVideoMarks(
  input: Uint8Array,
  opts: { caption?: string; aspectRatio: string }
): Promise<Buffer> {
  if (!ffmpegStatic) throw new Error("ffmpeg binary not available.");

  const dir = await mkdtemp(path.join(tmpdir(), "marks-"));
  const inPath = path.join(dir, "in.mp4");
  const outPath = path.join(dir, "out.mp4");
  const badgePath = path.join(dir, "badge.txt");
  const capPath = path.join(dir, "caption.txt");

  try {
    await writeFile(inPath, input);
    await writeFile(badgePath, AI_DISCLOSURE_TEXT);

    // Disclosure watermark — top-right corner, subtle but legible, not removable.
    const watermark =
      `drawtext=fontfile=${FONT_PATH}:textfile=${badgePath}:reload=0:` +
      `fontcolor=white@0.95:fontsize=20:borderw=1:bordercolor=black@0.85:` +
      `box=1:[email protected]:boxborderw=8:x=w-text_w-18:y=18`;

    const filters = [watermark];

    const caption = (opts.caption ?? "").trim();
    if (caption) {
      await writeFile(capPath, caption);
      filters.push(
        `drawtext=fontfile=${FONT_PATH}:textfile=${capPath}:reload=0:` +
          `fontcolor=white:fontsize=28:borderw=2:bordercolor=black@0.9:` +
          `box=1:[email protected]:boxborderw=12:line_spacing=6:` +
          `x=(w-text_w)/2:y=${captionY(opts.aspectRatio)}`
      );
    }

    const args = [
      "-y",
      "-i",
      inPath,
      "-vf",
      filters.join(","),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "copy",
      outPath,
    ];

    try {
      await runFfmpeg(args);
    } catch {
      // One retry — guards against a transient ffmpeg hiccup without ever
      // shipping an unmarked video.
      await runFfmpeg(args);
    }

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic as string, args);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}
