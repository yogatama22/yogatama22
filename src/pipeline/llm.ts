import { config } from "../config.js";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/**
 * Send a system+user prompt to the OpenRouter (OpenAI-compatible) chat API and
 * return the assistant's text content. Shared by moment selection and idea
 * research so provider/model config lives in one place.
 */
export async function chatComplete(
  system: string,
  user: string,
  opts: { temperature?: number } = {}
): Promise<string> {
  const res = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openrouter.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/auto-clipper",
      "X-Title": "auto-clipper",
    },
    body: JSON.stringify({
      model: config.openrouter.model,
      temperature: opts.temperature ?? 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
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
  if (data.error) throw new Error(`OpenRouter error: ${data.error.message}`);

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty response.");
  return content;
}

/** Remove ```json fences and grab the first JSON array in the text. */
export function extractJsonArray(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("LLM response did not contain a JSON array.");
  }
  return body.slice(start, end + 1);
}
