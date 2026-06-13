import path from "node:path";
import { readdir } from "node:fs/promises";
import { config } from "../config.js";
import { run } from "../utils/exec.js";

export interface SearchResult {
  id: string;
  title: string;
  channel: string;
  durationSec: number;
  views: number;
  url: string;
}

/**
 * Search YouTube via yt-dlp's "ytsearchN:" query. Uses --flat-playlist for a
 * fast listing (no per-video extraction).
 */
export async function searchYouTube(
  query: string,
  limit: number
): Promise<SearchResult[]> {
  const { stdout } = await run(config.youtube.bin, [
    `ytsearch${limit}:${query}`,
    "--flat-playlist",
    "--dump-json",
    "--no-warnings",
  ]);

  const results: SearchResult[] = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      const id = String(j.id ?? "");
      if (!id) continue;
      results.push({
        id,
        title: String(j.title ?? "(no title)"),
        channel: String(j.channel ?? j.uploader ?? ""),
        durationSec: Math.round(Number(j.duration ?? 0)),
        views: Number(j.view_count ?? 0),
        url: String(j.url ?? `https://www.youtube.com/watch?v=${id}`),
      });
    } catch {
      // skip malformed lines
    }
  }
  return results;
}

/**
 * Download a single YouTube video (best quality up to 1080p, merged to mp4)
 * into workDir. Returns the path to the downloaded file.
 */
export async function downloadVideo(
  urlOrId: string,
  workDir: string
): Promise<string> {
  await run(config.youtube.bin, [
    "-f",
    "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "--no-warnings",
    "-o",
    path.join(workDir, "source.%(ext)s"),
    urlOrId,
  ]);

  // yt-dlp may produce source.mp4 / source.mkv / source.webm depending on the
  // available streams — find whatever it wrote.
  const files = await readdir(workDir);
  const file = files.find(
    (f) =>
      f.startsWith("source.") &&
      !f.endsWith(".json") &&
      !f.endsWith(".part") &&
      !f.endsWith(".ytdl")
  );
  if (!file) {
    throw new Error("Download finished but no output file was found in workDir.");
  }
  return path.join(workDir, file);
}

/** Format seconds as m:ss (or h:mm:ss). */
export function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return "?";
  const s = sec % 60;
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Format a view count compactly (e.g. 1.2M, 34K). */
export function formatViews(views: number): string {
  if (!views || views <= 0) return "?";
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`;
  return String(views);
}
