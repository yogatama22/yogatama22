import { chatComplete, extractJsonArray } from "./llm.js";
import { searchYouTube, formatViews } from "./youtube.js";

export interface ContentIdea {
  /** catchy clip idea */
  title: string;
  /** why it's trending / the hook angle */
  angle: string;
  /** a ready-to-use YouTube search query to find source videos */
  query: string;
}

const SYSTEM_PROMPT = `You are a short-form video strategist. Given a list of currently popular YouTube video titles in a niche, identify recurring themes and trends, then propose specific, actionable short-clip ideas (TikTok / Reels / Shorts).
Rules:
- Each idea must be concrete and timely, grounded in the observed titles.
- Provide a YouTube search query that would surface good SOURCE videos to clip.
- Output ONLY a JSON array. No prose, no markdown.`;

function buildUserPrompt(niche: string, titles: string, count: number): string {
  return `Niche: ${niche}

Popular recent videos in this niche:
${titles}

Propose ${count} trending short-form clip ideas. Return a JSON array of objects:
[{ "title": "<catchy idea>", "angle": "<why it's trending / the hook>", "query": "<YouTube search query to find source videos>" }]`;
}

/**
 * Research trending clip ideas for a niche: pull popular videos via yt-dlp,
 * then have the LLM synthesize concrete, actionable ideas with search queries.
 */
export async function generateIdeas(
  niche: string,
  count: number,
  sampleSize = 25
): Promise<ContentIdea[]> {
  const results = await searchYouTube(niche, sampleSize);
  if (results.length === 0) {
    throw new Error(`No YouTube results found for niche "${niche}".`);
  }

  const titles = results
    .map((r, i) => `${i + 1}. ${r.title} (${formatViews(r.views)} views)`)
    .join("\n");

  const content = await chatComplete(
    SYSTEM_PROMPT,
    buildUserPrompt(niche, titles, count),
    { temperature: 0.7 }
  );

  const parsed = JSON.parse(extractJsonArray(content)) as ContentIdea[];
  return parsed
    .slice(0, count)
    .map((x) => ({
      title: String(x.title ?? "").trim() || "(untitled idea)",
      angle: String(x.angle ?? "").trim(),
      query: String(x.query ?? "").trim(),
    }))
    .filter((x) => x.query.length > 0);
}
