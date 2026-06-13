#!/usr/bin/env -S npx tsx
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { log } from "./utils/logger.js";
import { runClipPipeline, type PipelineOptions } from "./pipeline/clip.js";
import { parseFocus, type LayoutMode } from "./pipeline/reframe.js";
import {
  searchYouTube,
  downloadVideo,
  formatDuration,
  formatViews,
} from "./pipeline/youtube.js";
import { generateIdeas } from "./pipeline/ideas.js";

const program = new Command();
program
  .name("clipper")
  .description(
    "Turn a long video into vertical short clips with auto karaoke captions."
  );

/** Add the options shared by every command that runs the clip pipeline. */
function addClipOptions(cmd: Command): Command {
  return cmd
    .option("-t, --topic <text>", "topic/style focus (e.g. komedi, edukasi)", "viral, engaging moments")
    .option("-n, --num-clips <number>", "how many clips to produce", "3")
    .option("--min <seconds>", "minimum clip duration", "20")
    .option("--max <seconds>", "maximum clip duration", "60")
    .option("-o, --out <dir>", "output directory", "./output")
    .option("--layout <mode>", "reframe: auto | single | split | center", "auto")
    .option("--focus <pos>", "manual horizontal focus: center | left | right | 0.0-1.0")
    .option("--dry-run", "only select moments and print them; do not render", false)
    .option("--keep-work", "keep the temporary work directory", false);
}

function toPipelineOptions(opts: Record<string, unknown>): PipelineOptions {
  const layout = String(opts.layout ?? "auto") as LayoutMode;
  return {
    topic: String(opts.topic),
    numClips: parseInt(String(opts.numClips), 10),
    minDuration: parseInt(String(opts.min), 10),
    maxDuration: parseInt(String(opts.max), 10),
    outDir: String(opts.out),
    dryRun: Boolean(opts.dryRun),
    keepWork: Boolean(opts.keepWork),
    layout: ["auto", "single", "split", "center"].includes(layout) ? layout : "auto",
    focus: parseFocus(opts.focus as string | undefined),
  };
}

/** Ask the user to pick a result number; returns null if cancelled. */
async function promptChoice(max: number): Promise<number | null> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (
      await rl.question(`\n  Pilih nomor video (1-${max}), atau 'q' untuk batal: `)
    ).trim();
    if (answer.toLowerCase() === "q" || answer === "") return null;
    const n = parseInt(answer, 10);
    if (Number.isNaN(n) || n < 1 || n > max) return null;
    return n;
  } finally {
    rl.close();
  }
}

// --- clip: a local video file (also the default command) ---
addClipOptions(program.command("clip", { isDefault: true }))
  .description("Clip a local video file")
  .requiredOption("-i, --input <file>", "path to the source video")
  .action(async (opts) => {
    const file = path.resolve(String(opts.input));
    if (!existsSync(file)) {
      log.error(`Input file not found: ${file}`);
      process.exit(1);
    }
    await runClipPipeline(file, toPipelineOptions(opts));
  });

// --- youtube: download a specific URL/ID, then clip ---
addClipOptions(program.command("youtube"))
  .description("Download a YouTube video by URL/ID, then clip it")
  .argument("<url>", "YouTube video URL or ID")
  .action(async (url: string, opts) => {
    const outDir = path.resolve(String(opts.out));
    const workDir = path.join(outDir, ".work");
    await mkdir(workDir, { recursive: true });

    log.info(`Downloading from YouTube: ${url}`);
    const file = await downloadVideo(url, workDir);
    log.ok(`downloaded: ${path.basename(file)}`);

    await runClipPipeline(file, toPipelineOptions(opts), workDir);
  });

// --- search: search YouTube, pick one interactively, then clip ---
addClipOptions(program.command("search"))
  .description("Search YouTube, pick a video, then clip it")
  .argument("<query...>", "search keywords")
  .option("-r, --results <n>", "number of search results to show", "10")
  .action(async (queryParts: string[], opts) => {
    const query = queryParts.join(" ");
    log.info(`Searching YouTube: "${query}"...`);
    const results = await searchYouTube(query, parseInt(String(opts.results), 10));
    if (results.length === 0) {
      log.error("No results found.");
      process.exit(1);
    }

    console.log("");
    results.forEach((r, i) => {
      const idx = String(i + 1).padStart(2, "0");
      console.log(
        `  ${idx}. ${r.title}\n      ${r.channel} · ${formatDuration(r.durationSec)} · ${formatViews(r.views)} views`
      );
    });

    const choice = await promptChoice(results.length);
    if (choice == null) {
      log.info("Dibatalkan.");
      return;
    }
    const picked = results[choice - 1];

    const outDir = path.resolve(String(opts.out));
    const workDir = path.join(outDir, ".work");
    await mkdir(workDir, { recursive: true });

    log.info(`Downloading: ${picked.title}`);
    const file = await downloadVideo(picked.url, workDir);
    log.ok(`downloaded: ${path.basename(file)}`);

    await runClipPipeline(file, toPipelineOptions(opts), workDir);
  });

// --- ideas: research trending clip ideas for a niche ---
program
  .command("ideas")
  .description("Research trending clip ideas for a niche")
  .argument("<niche...>", "the niche / topic to research")
  .option("-n, --num <n>", "number of ideas to generate", "8")
  .option("--sample <n>", "popular videos to analyze", "25")
  .action(async (parts: string[], opts) => {
    const niche = parts.join(" ");
    log.info(`Researching trending ideas for: "${niche}"...`);
    const ideas = await generateIdeas(
      niche,
      parseInt(String(opts.num), 10),
      parseInt(String(opts.sample), 10)
    );
    if (ideas.length === 0) {
      log.error("No ideas generated. Try a broader niche.");
      process.exit(1);
    }

    console.log(`\n  Trending clip ideas for "${niche}":\n`);
    ideas.forEach((idea, i) => {
      const idx = String(i + 1).padStart(2, "0");
      console.log(`  ${idx}. ${idea.title}`);
      if (idea.angle) console.log(`      ${idea.angle}`);
      console.log(`      → npm run clip -- search "${idea.query}"\n`);
    });
  });

program.parseAsync().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
