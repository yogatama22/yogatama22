import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { log } from "../utils/logger.js";
import { extractAudio, probeDuration } from "./audio.js";
import { transcribe } from "./transcribe.js";
import { selectMoments } from "./selectMoments.js";
import { renderClip } from "./render.js";
import type { LayoutMode } from "./reframe.js";
import type { ClipOptions } from "../types.js";

export interface PipelineOptions {
  topic: string;
  numClips: number;
  minDuration: number;
  maxDuration: number;
  outDir: string;
  dryRun: boolean;
  keepWork: boolean;
  layout: LayoutMode;
  focus: number | null;
}

/**
 * Core pipeline: a local video file -> transcript -> selected moments ->
 * captioned vertical clips. Shared by the clip / youtube / search commands.
 */
export async function runClipPipeline(
  videoPath: string,
  options: PipelineOptions,
  existingWorkDir?: string
): Promise<string[]> {
  const outDir = path.resolve(options.outDir);
  const workDir = existingWorkDir ?? path.join(outDir, ".work");
  await mkdir(outDir, { recursive: true });
  await mkdir(workDir, { recursive: true });

  const clipOptions: ClipOptions = {
    input: videoPath,
    outDir,
    workDir,
    topic: options.topic,
    numClips: options.numClips,
    minDuration: options.minDuration,
    maxDuration: options.maxDuration,
  };

  const total = options.dryRun ? 4 : 5;

  log.step(1, total, "Probing video & extracting audio...");
  const durationSec = await probeDuration(videoPath);
  const wav = await extractAudio(videoPath, workDir);
  log.ok(`audio ready (${durationSec.toFixed(1)}s source)`);

  log.step(2, total, "Transcribing with whisper.cpp (word-level)...");
  const words = await transcribe(wav);
  log.ok(`${words.length} words transcribed`);

  log.step(3, total, `Selecting moments via OpenRouter (topic: ${clipOptions.topic})...`);
  const moments = await selectMoments(words, clipOptions, durationSec);
  if (moments.length === 0) {
    throw new Error("No clip moments were selected. Try a different topic or video.");
  }
  log.ok(`${moments.length} moment(s) selected`);

  console.log("\n  Selected moments:");
  moments.forEach((m, i) => {
    const dur = (m.end - m.start).toFixed(0);
    console.log(
      `   ${String(i + 1).padStart(2, "0")}. [${m.start.toFixed(1)}s -> ${m.end.toFixed(1)}s, ${dur}s] ${m.title}`
    );
    if (m.reason) console.log(`       ${m.reason}`);
  });

  await writeFile(
    path.join(outDir, "clips.json"),
    JSON.stringify(moments, null, 2),
    "utf8"
  );

  if (options.dryRun) {
    log.step(4, total, "Dry run complete.");
    log.ok(`manifest written to ${path.join(outDir, "clips.json")}`);
    console.log("\n  Re-run without --dry-run to render these clips.\n");
    return [];
  }

  log.step(4, total, "Rendering vertical clips with captions...");
  const rendered: string[] = [];
  for (let i = 0; i < moments.length; i++) {
    log.info(`rendering ${i + 1}/${moments.length}: ${moments[i].title}`);
    const out = await renderClip(videoPath, words, moments[i], i, workDir, outDir, {
      mode: options.layout,
      focus: options.focus,
    });
    rendered.push(out);
    log.ok(path.basename(out));
  }

  log.step(5, total, "Done!");
  if (!options.keepWork) {
    await rm(workDir, { recursive: true, force: true });
  }
  console.log(`\n  ${rendered.length} clip(s) saved to: ${outDir}\n`);
  return rendered;
}
