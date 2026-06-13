import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing required env var "${name}". Copy .env.example to .env and fill it in.`
    );
  }
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

export const config = {
  openrouter: {
    apiKey: required("OPENROUTER_API_KEY"),
    model: optional("OPENROUTER_MODEL", "deepseek/deepseek-chat-v3-0324:free"),
    baseUrl: optional("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
  },
  whisper: {
    cli: required("WHISPER_CLI"),
    model: required("WHISPER_MODEL"),
    lang: optional("WHISPER_LANG", "auto"),
  },
  ffmpeg: {
    bin: optional("FFMPEG_BIN", "ffmpeg"),
    probe: optional("FFPROBE_BIN", "ffprobe"),
  },
  youtube: {
    bin: optional("YTDLP_BIN", "yt-dlp"),
  },
  python: {
    bin: optional("PYTHON_BIN", "python3"),
  },
};

export type Config = typeof config;
