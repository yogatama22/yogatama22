import { readFile } from "node:fs/promises";
import { config } from "../config.js";
import { run } from "../utils/exec.js";
import type { Word } from "../types.js";

/** Shape of the whisper.cpp JSON output (the parts we use). */
interface WhisperJson {
  transcription?: Array<{
    offsets?: { from: number; to: number };
    text?: string;
  }>;
}

/**
 * Transcribe a 16 kHz WAV with whisper.cpp, returning word-level timings.
 *
 * Runs whisper-cli with `-ml 1 --split-on-word` so each segment is a single
 * word, and `-oj` to emit JSON we can parse.
 */
export async function transcribe(wavPath: string): Promise<Word[]> {
  await run(config.whisper.cli, [
    "-m",
    config.whisper.model,
    "-f",
    wavPath,
    "-l",
    config.whisper.lang,
    "-oj",
    "-ml",
    "1",
    "--split-on-word",
  ]);

  // whisper.cpp writes "<wavPath>.json"
  const jsonPath = `${wavPath}.json`;
  const raw = await readFile(jsonPath, "utf8");
  const data = JSON.parse(raw) as WhisperJson;

  if (!data.transcription || data.transcription.length === 0) {
    throw new Error(
      "Transcription returned no words. Check the audio file and whisper model."
    );
  }

  const words: Word[] = [];
  for (const seg of data.transcription) {
    const text = (seg.text ?? "").trim();
    if (!text || !seg.offsets) continue;
    words.push({
      text,
      start: seg.offsets.from,
      end: seg.offsets.to,
    });
  }

  if (words.length === 0) {
    throw new Error("No usable words after parsing the transcript.");
  }

  return words;
}

/** Convert milliseconds to "Hms" style seconds with one decimal. */
export function msToSec(ms: number): number {
  return Math.round(ms) / 1000;
}
