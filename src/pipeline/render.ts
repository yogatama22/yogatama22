import path from "node:path";
import { writeFile } from "node:fs/promises";
import { config } from "../config.js";
import { run } from "../utils/exec.js";
import { buildAss } from "./subtitles.js";
import { probeDimensions } from "./audio.js";
import { planReframe, type LayoutMode, type ReframePlan } from "./reframe.js";
import { log } from "../utils/logger.js";
import type { ClipMoment, Word } from "../types.js";

export interface RenderReframe {
  mode: LayoutMode;
  focus: number | null;
}

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

/** Round down to an even integer (required for yuv420 crop offsets/sizes). */
function even(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r - 1;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Render one clip: trim the source, reframe to vertical 1080x1920
 * (center / single-subject / split-screen), and burn in karaoke captions.
 */
export async function renderClip(
  inputVideo: string,
  words: Word[],
  clip: ClipMoment,
  index: number,
  workDir: string,
  outDir: string,
  reframe: RenderReframe
): Promise<string> {
  const slug = slugify(clip.title, index);
  const assName = `${slug}.ass`;
  await writeFile(path.join(workDir, assName), buildAss(words, clip), "utf8");

  const outPath = path.join(outDir, `${slug}.mp4`);
  const duration = Math.max(0.5, clip.end - clip.start);

  const { width: W, height: H } = await probeDimensions(inputVideo);
  const plan: ReframePlan =
    W > 0 && H > 0
      ? await planReframe(inputVideo, clip.start, duration, reframe.mode, reframe.focus)
      : { layout: "center" };

  // ffmpeg args common to every layout
  const head = [
    "-y",
    "-ss",
    clip.start.toFixed(3),
    "-i",
    path.resolve(inputVideo),
    "-t",
    duration.toFixed(3),
  ];
  const tail = [
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
  ];

  let args: string[];

  if (plan.layout === "split" && plan.centers) {
    log.info("layout: split-screen (2 subjects)");
    const cw = even(Math.min(H * (1080 / 960), W)); // each half: 1080x960 (9:8)
    const x1 = even(clamp(plan.centers[0] * W - cw / 2, 0, W - cw));
    const x2 = even(clamp(plan.centers[1] * W - cw / 2, 0, W - cw));
    const fc =
      `[0:v]split=2[a][b];` +
      `[a]crop=${cw}:${H}:${x1}:0,scale=1080:960[top];` +
      `[b]crop=${cw}:${H}:${x2}:0,scale=1080:960[bot];` +
      `[top][bot]vstack[stacked];` +
      `[stacked]subtitles=${assName}[v]`;
    args = [...head, "-filter_complex", fc, "-map", "[v]", "-map", "0:a?", ...tail];
  } else {
    const cw = even(Math.min(H * (9 / 16), W));
    let cx: number;
    if (plan.layout === "single" && typeof plan.center === "number") {
      log.info(`layout: single subject (focus ${(plan.center * 100).toFixed(0)}%)`);
      cx = even(clamp(plan.center * W - cw / 2, 0, W - cw));
    } else {
      log.info("layout: center crop");
      cx = even((W - cw) / 2);
    }
    const vf = `crop=${cw}:${H}:${cx}:0,scale=1080:1920,subtitles=${assName}`;
    args = [...head, "-vf", vf, ...tail];
  }

  await run(config.ffmpeg.bin, args, { cwd: workDir });
  return outPath;
}
