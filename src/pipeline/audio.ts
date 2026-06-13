import path from "node:path";
import { config } from "../config.js";
import { run } from "../utils/exec.js";

/**
 * Extract a whisper.cpp-compatible audio track from any video/audio file:
 * 16 kHz, mono, signed 16-bit PCM WAV.
 */
export async function extractAudio(
  input: string,
  workDir: string
): Promise<string> {
  const wavPath = path.join(workDir, "audio.wav");
  await run(config.ffmpeg.bin, [
    "-y",
    "-i",
    input,
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    wavPath,
  ]);
  return wavPath;
}

/** Return the duration of a media file in seconds (via ffprobe). */
export async function probeDuration(input: string): Promise<number> {
  const { stdout } = await run(config.ffmpeg.probe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    input,
  ]);
  const seconds = parseFloat(stdout.trim());
  return Number.isFinite(seconds) ? seconds : 0;
}

/** Return the pixel dimensions of the first video stream. */
export async function probeDimensions(
  input: string
): Promise<{ width: number; height: number }> {
  const { stdout } = await run(config.ffmpeg.probe, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=s=x:p=0",
    input,
  ]);
  const [w, h] = stdout.trim().split("x").map((n) => parseInt(n, 10));
  return {
    width: Number.isFinite(w) ? w : 0,
    height: Number.isFinite(h) ? h : 0,
  };
}
