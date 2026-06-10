// Server-only programmatic caption burner. Uses the self-contained
// ffmpeg-static binary (no system install) + a vendored TTF to draw the
// on-screen text onto the finished video via the drawtext filter. This is
// the cheap, real-time, no-extra-model-cost overlay (CLAUDE.md §4).

import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

const FONT_PATH = path.join(process.cwd(), "src/assets/fonts/Roboto-Bold.ttf");

// Vertical placement per aspect ratio (expression over input height `h` and
// the rendered text height `text_h`). Kept in the lower third, clear of edges.
function yExpr(aspectRatio: string): string {
  switch (aspectRatio) {
    case "9:16":
      return "h*0.80-text_h/2";
    case "1:1":
      return "h*0.84-text_h/2";
    case "16:9":
    default:
      return "h*0.85-text_h/2";
  }
}

// Burns `text` onto the MP4 in `input`. Returns a new MP4 buffer. Throws on
// any ffmpeg error so the caller can fall back to the original video.
export async function burnCaption(
  input: Uint8Array,
  text: string,
  aspectRatio: string
): Promise<Buffer> {
  if (!ffmpegStatic) throw new Error("ffmpeg binary not available.");

  const dir = await mkdtemp(path.join(tmpdir(), "overlay-"));
  const inPath = path.join(dir, "in.mp4");
  const outPath = path.join(dir, "out.mp4");
  const txtPath = path.join(dir, "caption.txt");

  try {
    await writeFile(inPath, input);
    // Use textfile to avoid drawtext escaping pitfalls with the user's text.
    await writeFile(txtPath, text);

    const drawtext =
      `drawtext=fontfile=${FONT_PATH}:textfile=${txtPath}:reload=0:` +
      `fontcolor=white:fontsize=28:borderw=2:bordercolor=black@0.9:` +
      `box=1:[email protected]:boxborderw=12:line_spacing=6:` +
      `x=(w-text_w)/2:y=${yExpr(aspectRatio)}`;

    await runFfmpeg([
      "-y",
      "-i",
      inPath,
      "-vf",
      drawtext,
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
    ]);

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
