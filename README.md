# auto-clipper

A local-first CLI that turns a long video into vertical (9:16) short clips with
auto-generated **karaoke-style captions** — built for clippers on YouTube
Shorts / TikTok / Reels.

Pipeline:

```
video ──▶ ffmpeg (audio) ──▶ whisper.cpp (transcript) ──▶ OpenRouter (pick moments)
      ──▶ ffmpeg (cut + crop 9:16 + burn captions) ──▶ clips/*.mp4
```

Everything heavy runs **locally** (transcription on your machine via
whisper.cpp). The only network call is one request per video to OpenRouter to
choose the best moments — small enough for the free tier.

---

## Prerequisites

You need these installed on your machine:

| Tool | Install |
|------|---------|
| **Node.js** ≥ 20 | https://nodejs.org |
| **ffmpeg** + **ffprobe** | `brew install ffmpeg` |
| **whisper.cpp** (built) | see below |

### whisper.cpp (macOS Apple Silicon)

```bash
# NOTE: use ffmpeg-full (not plain ffmpeg) — it includes libass, required to
# burn the captions. yt-dlp is needed for the YouTube commands (Phase 2).
brew install ffmpeg-full yt-dlp cmake git
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build
cmake --build build -j --config Release
sh ./models/download-ggml-model.sh large-v3-turbo
```

This gives you:
- binary: `whisper.cpp/build/bin/whisper-cli`
- model: `whisper.cpp/models/ggml-large-v3-turbo.bin`

---

## Setup

```bash
npm install
cp .env.example .env
```

Then edit `.env`:

```ini
OPENROUTER_API_KEY=sk-or-v1-...          # https://openrouter.ai/keys
OPENROUTER_MODEL=qwen/qwen3-next-80b-a3b-instruct:free
WHISPER_CLI=/abs/path/to/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL=/abs/path/to/whisper.cpp/models/ggml-large-v3-turbo.bin
WHISPER_LANG=id
```

> **Never commit `.env`.** It is gitignored. If a key ever leaks, rotate it at
> https://openrouter.ai/keys immediately.

---

## Usage

There are three commands. All share the same clip options below.

```bash
# 1) Clip a LOCAL video file (default command)
npm run clip -- -i ./video.mp4 -t "komedi" -n 3

# preview which moments would be picked (no rendering)
npm run clip -- -i ./video.mp4 -t "edukasi" --dry-run

# 2) Clip a specific YOUTUBE video (downloads first)
npm run clip -- youtube "https://youtu.be/VIDEO_ID" -t "komedi" -n 3

# 3) SEARCH YouTube, pick a result interactively, then clip
npm run clip -- search "stand up comedy indonesia" -t "komedi" -r 10
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-i, --input <file>` | (clip cmd) | source video file |
| `-t, --topic <text>` | `viral, engaging moments` | style focus (komedi, edukasi, motivasi, ...) |
| `-n, --num-clips <n>` | `3` | how many clips to produce |
| `--min <seconds>` | `20` | minimum clip duration |
| `--max <seconds>` | `60` | maximum clip duration |
| `-o, --out <dir>` | `./output` | output directory |
| `--layout <mode>` | `auto` | reframe: `auto`, `single`, `split`, `center` |
| `--focus <pos>` | (off) | manual focus: `center`, `left`, `right`, or `0.0`-`1.0` |
| `-r, --results <n>` | `10` | (search cmd) results to show |
| `--dry-run` | off | only select & print moments |
| `--keep-work` | off | keep temporary files |

Output clips land in `./output/` along with a `clips.json` manifest.

### Auto-reframe (keep the subject in frame)

When cropping landscape → vertical, the clipper detects faces and reframes:

- **1 face** → crop centered on that subject
- **2 faces** (e.g. a podcast) → **split-screen**, both people stacked
- **no/unclear faces** → plain center crop (automatic fallback)

This uses a small OpenCV helper (`scripts/reframe.py`). Install its deps:

```bash
pip install opencv-python numpy
```

If OpenCV isn't installed, the clipper still works — it just falls back to a
center crop. Force a specific behaviour with `--layout` / `--focus`:

```bash
npm run clip -- -i ./podcast.mp4 --layout split        # force split-screen
npm run clip -- -i ./talk.mp4 --focus right            # manual center crop on the right
```

---

## Swapping the LLM provider

The moment-selector uses an OpenAI-compatible endpoint, so you can point it at
any provider by changing `.env` only — no code changes:

| Provider | `OPENROUTER_BASE_URL` | `OPENROUTER_MODEL` |
|----------|------------------------|--------------------|
| OpenRouter (default) | `https://openrouter.ai/api/v1` | `qwen/qwen3-next-80b-a3b-instruct:free` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.1` |

> Free model slugs on OpenRouter rotate over time. If you get a 404 saying a
> model is no longer free, list the currently-free ones with:
> ```bash
> curl -s https://openrouter.ai/api/v1/models | jq -r '.data[] | select(.pricing.prompt=="0") | .id'
> ```
> then set `OPENROUTER_MODEL` to any `:free` text model with a large context window.

---

## Roadmap

- [x] **Phase 1** — local video → transcript → moment selection → captioned clips
- [x] **Phase 2** — search YouTube & pick a source video from the CLI
- [x] **Phase 3** — auto-reframe (face-aware crop + split-screen for 2 people)
- [ ] Phase 4 — trending-idea research + web/desktop UI

## Notes on copyright

Only clip content you have the right to use (your own, Creative Commons, or
creators who allow clipping). Reposting others' content without permission may
violate copyright and platform terms.
