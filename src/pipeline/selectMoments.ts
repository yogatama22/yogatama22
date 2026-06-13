import { config } from "../config.js";
import type { ClipMoment, ClipOptions, Word } from "../types.js";

/**
 * Group words into short timestamped lines so the transcript we send to the
 * LLM is readable and compact (instead of one word per line).
 */
function buildTimestampedTranscript(words: Word[]): string {
  const lines: string[] = [];
  let buffer: string[] = [];
  let lineStartMs = words[0]?.start ?? 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const t = (lineStartMs / 1000).toFixed(1);
    lines.push(`[${t}] ${buffer.join(" ")}`);
    buffer = [];
  };

  for (const w of words) {
    if (buffer.length === 0) lineStartMs = w.start;
    buffer.push(w.text);
    // new line roughly every ~12 words or on sentence-ending punctuation
    if (buffer.length >= 12 || /[.!?]$/.test(w.text)) flush();
  }
  flush();
  return lines.join("\n");
}

/** Remove ```json fences and grab the first JSON array in the text. */
function extractJsonArray(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("LLM response did not contain a JSON array.");
  }
  return body.slice(start, end + 1);
}

const SYSTEM_PROMPT = `You are an expert short-form video editor. You read a timestamped transcript of a long video and select the most engaging self-contained segments to turn into vertical short clips (TikTok / Reels / Shorts).
Rules:
- Each clip must start and end on natural sentence boundaries (no mid-sentence cuts).
- Each clip should be a complete, self-contained thought with a strong hook in the first seconds.
- Respect the requested topic/style, target duration, and number of clips.
- Output ONLY a JSON array. No prose, no markdown.`;

function buildUserPrompt(transcript: string, opts: ClipOptions): string {
  return `Topic / style focus: ${opts.topic}
Number of clips to select: ${opts.numClips}
Target duration per clip: between ${opts.minDuration} and ${opts.maxDuration} seconds.

Return a JSON array of exactly up to ${opts.numClips} objects with this shape:
[{ "start": <seconds:number>, "end": <seconds:number>, "title": "<short catchy title>", "reason": "<why this clip works>" }]

Timestamps in [brackets] are the start time (in seconds) of that line.

TRANSCRIPT:
${transcript}`;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/**
 * Ask the LLM (via the OpenRouter OpenAI-compatible API) to choose clip
 * moments. One request per video to stay within free-tier rate limits.
 */
export async function selectMoments(
  words: Word[],
  opts: ClipOptions,
  videoDurationSec: number
): Promise<ClipMoment[]> {
  const transcript = buildTimestampedTranscript(words);

  const res = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openrouter.apiKey}`,
      "Content-Type": "application/json",
      // Optional attribution headers recommended by OpenRouter
      "HTTP-Referer": "https://github.com/auto-clipper",
      "X-Title": "auto-clipper",
    },
    body: JSON.stringify({
      model: config.openrouter.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(transcript, opts) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `OpenRouter request failed (${res.status}). ${text.slice(0, 500)}`
    );
  }

  const data = (await res.json()) as ChatResponse;
  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.message}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  const parsed = JSON.parse(extractJsonArray(content)) as ClipMoment[];
  return sanitizeMoments(parsed, opts, videoDurationSec);
}

/** Clamp/validate moments against duration limits and the video length. */
function sanitizeMoments(
  moments: ClipMoment[],
  opts: ClipOptions,
  videoDurationSec: number
): ClipMoment[] {
  const cleaned: ClipMoment[] = [];
  for (const m of moments) {
    let start = Math.max(0, Number(m.start));
    let end = Math.min(videoDurationSec || Number(m.end), Number(m.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    // enforce max duration; keep the hook by trimming the tail
    if (end - start > opts.maxDuration) end = start + opts.maxDuration;
    if (end - start < Math.min(opts.minDuration, 1)) continue;

    cleaned.push({
      start,
      end,
      title: (m.title ?? "clip").toString().trim() || "clip",
      reason: (m.reason ?? "").toString().trim(),
    });
  }
  return cleaned.slice(0, opts.numClips);
}
