import path from "node:path";
import { writeFile } from "node:fs/promises";
import { config } from "../config.js";
import { run } from "../utils/exec.js";
import { buildAss } from "./subtitles.js";
import type { ClipMoment, Word } from "../types.js";

/** Make a filesystem-safe slug from a clip title. */
function slugify(title: string, index: number): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const n = String(index + 1).padStart(2, "0");
  return base ? `${n}-${base}` : `clip-${n}`;
}

/**
 * Render one clip: trim the source, crop+scale to vertical 1080x1920, and
 * burn in the karaoke captions. Returns the output file path.
 */
export async function renderClip(
  inputVideo: string,
  words: Word[],
  clip: ClipMoment,
  index: number,
  workDir: string,
  outDir: string
): Promise<string> {
  const slug = slugify(clip.title, index);

  // Write the per-clip subtitle file inside workDir. We run ffmpeg with
  // cwd=workDir and reference the .ass by bare filename so the subtitles
  // filter never has to deal with awkward path escaping.
  const assName = `${slug}.ass`;
  await writeFile(path.join(workDir, assName), buildAss(words, clip), "utf8");

  const outPath = path.join(outDir, `${slug}.mp4`);
  const duration = Math.max(0.5, clip.end - clip.start);

  // crop a centered 9:16 window, scale to 1080x1920, then burn subtitles.
  // The escaped comma (\,) keeps min() as a single crop expression.
  const vf = [
    "crop=w=min(iw\\,ih*9/16):h=ih",
    "scale=1080:1920",
    `subtitles=${assName}`,
  ].join(",");

  await run(
    config.ffmpeg.bin,
    [
      "-y",
      "-ss",
      clip.start.toFixed(3),
      "-i",
      path.resolve(inputVideo),
      "-t",
      duration.toFixed(3),
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      path.resolve(outPath),
    ],
    { cwd: workDir }
  );

  return outPath;
}
