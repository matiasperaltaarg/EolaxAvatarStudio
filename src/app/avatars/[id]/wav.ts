// Client-side audio helpers: decode a recorded blob (webm/opus, mp4/aac, …)
// and re-encode it to a clean 44.1 kHz mono 16-bit PCM WAV. We do this in the
// browser because Vercel serverless has no ffmpeg, and ElevenLabs clones from
// uncompressed WAV far better than from compressed chat-app audio.

export const WAV_SAMPLE_RATE = 44100;

export type ProcessedAudio = {
  wav: Blob;
  durationSeconds: number;
  peak: number; // 0..1 — used for a "too quiet" check
};

export async function blobToCleanWav(input: Blob): Promise<ProcessedAudio> {
  const arrayBuf = await input.arrayBuffer();

  // Decode with a regular AudioContext (handles whatever the recorder produced).
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const decodeCtx = new AC();
  const decoded = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
  await decodeCtx.close();

  // Resample + downmix to mono at 44.1 kHz via an OfflineAudioContext.
  const frames = Math.max(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, WAV_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();

  const samples = rendered.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }

  return {
    wav: encodeWav(samples, WAV_SAMPLE_RATE),
    durationSeconds: rendered.duration,
    peak,
  };
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}
