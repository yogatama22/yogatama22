#!/usr/bin/env -S npx tsx
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { log } from "./utils/logger.js";
import { extractAudio, probeDuration } from "./pipeline/audio.js";
import { transcribe } from "./pipeline/transcribe.js";
import { selectMoments } from "./pipeline/selectMoments.js";
import { renderClip } from "./pipeline/render.js";
import type { ClipOptions } from "./types.js";

const program = new Command();

program
  .name("clipper")
  .description(
    "Turn a long video into vertical short clips with auto karaoke captions."
  )
  .requiredOption("-i, --input <file>", "path to the source video")
  .option("-t, --topic <text>", "topic/style focus (e.g. komedi, edukasi)", "viral, engaging moments")
  .option("-n, --num-clips <number>", "how many clips to produce", "3")
  .option("--min <seconds>", "minimum clip duration", "20")
  .option("--max <seconds>", "maximum clip duration", "60")
  .option("-o, --out <dir>", "output directory", "./output")
  .option("--dry-run", "only select moments and print them; do not render", false)
  .option("--keep-work", "keep the temporary work directory", false);

program.parse();
const opts = program.opts();

async function main() {
  const input = path.resolve(opts.input as string);
  if (!existsSync(input)) {
    log.error(`Input file not found: ${input}`);
    process.exit(1);
  }

  const outDir = path.resolve(opts.out as string);
  const workDir = path.join(outDir, ".work");
  await mkdir(outDir, { recursive: true });
  await mkdir(workDir, { recursive: true });

  const clipOptions: ClipOptions = {
    input,
    outDir,
    workDir,
    topic: opts.topic as string,
    numClips: parseInt(opts.numClips as string, 10),
    minDuration: parseInt(opts.min as string, 10),
    maxDuration: parseInt(opts.max as string, 10),
  };

  const total = opts.dryRun ? 4 : 5;

  log.step(1, total, "Probing video & extracting audio...");
  const durationSec = await probeDuration(input);
  const wav = await extractAudio(input, workDir);
  log.ok(`audio ready (${durationSec.toFixed(1)}s source)`);

  log.step(2, total, "Transcribing with whisper.cpp (word-level)...");
  const words = await transcribe(wav);
  log.ok(`${words.length} words transcribed`);

  log.step(3, total, `Selecting moments via OpenRouter (topic: ${clipOptions.topic})...`);
  const moments = await selectMoments(words, clipOptions, durationSec);
  if (moments.length === 0) {
    log.error("No clip moments were selected. Try a different topic or video.");
    process.exit(1);
  }
  log.ok(`${moments.length} moment(s) selected`);

  // Review step: always show the candidates
  console.log("\n  Selected moments:");
  moments.forEach((m, i) => {
    const dur = (m.end - m.start).toFixed(0);
    console.log(
      `   ${String(i + 1).padStart(2, "0")}. [${m.start.toFixed(1)}s -> ${m.end.toFixed(1)}s, ${dur}s] ${m.title}`
    );
    if (m.reason) console.log(`       ${m.reason}`);
  });

  // Always write a manifest so you can review/re-render later
  await writeFile(
    path.join(outDir, "clips.json"),
    JSON.stringify(moments, null, 2),
    "utf8"
  );

  if (opts.dryRun) {
    log.step(4, total, "Dry run complete.");
    log.ok(`manifest written to ${path.join(outDir, "clips.json")}`);
    console.log("\n  Re-run without --dry-run to render these clips.\n");
    return;
  }

  log.step(4, total, "Rendering vertical clips with captions...");
  const rendered: string[] = [];
  for (let i = 0; i < moments.length; i++) {
    log.info(`rendering ${i + 1}/${moments.length}: ${moments[i].title}`);
    const out = await renderClip(input, words, moments[i], i, workDir, outDir);
    rendered.push(out);
    log.ok(path.basename(out));
  }

  log.step(5, total, "Done!");
  if (!opts.keepWork) {
    await rm(workDir, { recursive: true, force: true });
  }
  console.log(`\n  ${rendered.length} clip(s) saved to: ${outDir}\n`);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
