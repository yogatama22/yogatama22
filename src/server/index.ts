import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readdir, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import express from "express";
import { logEvents } from "../utils/logger.js";
import { searchYouTube, downloadVideo } from "../pipeline/youtube.js";
import { generateIdeas } from "../pipeline/ideas.js";
import { runClipPipeline, type PipelineOptions } from "../pipeline/clip.js";
import { parseFocus, type LayoutMode } from "../pipeline/reframe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");
const OUTPUT = path.resolve(process.env.OUTPUT_DIR || path.join(ROOT, "output"));
const PORT = parseInt(process.env.PORT || "5173", 10);

type JobStatus = "running" | "done" | "error";
interface Job {
  id: string;
  status: JobStatus;
  logs: string[];
  clips: string[];
  error?: string;
  bus: EventEmitter;
}

const jobs = new Map<string, Job>();
let busy = false;

/** Build PipelineOptions from a loosely-typed request body. */
function buildOptions(body: Record<string, unknown>): PipelineOptions {
  const layout = String(body.layout ?? "auto") as LayoutMode;
  return {
    topic: String(body.topic ?? "viral, engaging moments"),
    numClips: parseInt(String(body.numClips ?? "3"), 10),
    minDuration: parseInt(String(body.minDuration ?? "20"), 10),
    maxDuration: parseInt(String(body.maxDuration ?? "60"), 10),
    outDir: OUTPUT,
    dryRun: Boolean(body.dryRun),
    keepWork: false,
    layout: ["auto", "single", "split", "center"].includes(layout) ? layout : "auto",
    focus: parseFocus(body.focus as string | undefined),
  };
}

async function runJob(
  job: Job,
  source: { type: "file" | "url"; value: string },
  options: PipelineOptions
) {
  const onLine = (line: string) => {
    job.logs.push(line);
    job.bus.emit("line", line);
  };
  logEvents.on("line", onLine);
  try {
    let videoPath: string;
    let workDir: string | undefined;
    if (source.type === "url") {
      workDir = path.join(OUTPUT, ".work");
      await mkdir(workDir, { recursive: true });
      onLine(`Downloading: ${source.value}`);
      videoPath = await downloadVideo(source.value, workDir);
    } else {
      videoPath = path.resolve(source.value);
      if (!existsSync(videoPath)) {
        throw new Error(`File not found: ${videoPath}`);
      }
    }
    const clips = await runClipPipeline(videoPath, options, workDir);
    job.clips = clips.map((c) => path.basename(c));
    job.status = "done";
    job.bus.emit("done", job.clips);
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.bus.emit("error", job.error);
  } finally {
    logEvents.off("line", onLine);
    busy = false;
  }
}

const app = express();
app.use(express.json());
app.use("/", express.static(PUBLIC));
app.use("/clips", express.static(OUTPUT));

// --- search ---
app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const n = parseInt(String(req.query.n ?? "10"), 10);
    if (!q) return res.status(400).json({ error: "missing query 'q'" });
    res.json({ results: await searchYouTube(q, n) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- ideas ---
app.post("/api/ideas", async (req, res) => {
  try {
    const niche = String(req.body?.niche ?? "").trim();
    const num = parseInt(String(req.body?.num ?? "8"), 10);
    if (!niche) return res.status(400).json({ error: "missing 'niche'" });
    res.json({ ideas: await generateIdeas(niche, num) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- list rendered clips ---
app.get("/api/clips", async (_req, res) => {
  try {
    if (!existsSync(OUTPUT)) return res.json({ clips: [] });
    const files = (await readdir(OUTPUT)).filter((f) => f.endsWith(".mp4"));
    res.json({ clips: files });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- start a clip job ---
app.post("/api/jobs", (req, res) => {
  if (busy) {
    return res.status(409).json({ error: "A job is already running. Try again when it finishes." });
  }
  const body = req.body ?? {};
  const source = body.source as { type: "file" | "url"; value: string } | undefined;
  if (!source || !source.value) {
    return res.status(400).json({ error: "missing 'source' {type,value}" });
  }

  busy = true;
  const job: Job = {
    id: randomUUID(),
    status: "running",
    logs: [],
    clips: [],
    bus: new EventEmitter(),
  };
  job.bus.setMaxListeners(20);
  jobs.set(job.id, job);

  // fire and forget; progress is observed via the SSE endpoint
  void runJob(job, source, buildOptions(body.options ?? {}));
  res.json({ jobId: job.id });
});

// --- stream job progress (SSE) ---
app.get("/api/jobs/:id/events", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // replay buffered logs for late subscribers
  for (const line of job.logs) send("line", line);

  if (job.status === "done") {
    send("done", job.clips);
    return res.end();
  }
  if (job.status === "error") {
    send("error", job.error);
    return res.end();
  }

  const onLine = (line: string) => send("line", line);
  const onDone = (clips: string[]) => {
    send("done", clips);
    cleanup();
    res.end();
  };
  const onError = (msg: string) => {
    send("error", msg);
    cleanup();
    res.end();
  };
  const cleanup = () => {
    job.bus.off("line", onLine);
    job.bus.off("done", onDone);
    job.bus.off("error", onError);
  };
  job.bus.on("line", onLine);
  job.bus.on("done", onDone);
  job.bus.on("error", onError);
  req.on("close", cleanup);
});

app.listen(PORT, () => {
  console.log(`\n  auto-clipper web UI running at http://localhost:${PORT}`);
  console.log(`  output dir: ${OUTPUT}\n`);
});
