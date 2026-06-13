import type { ClipMoment, Word } from "../types.js";

/** Visual style for the burned-in captions. Colours are ASS &HAABBGGRR. */
export interface CaptionStyle {
  fontName: string;
  fontSize: number;
  /** colour of a word AFTER it is spoken (the highlight) */
  highlight: string;
  /** colour of a word BEFORE it is spoken */
  base: string;
  outline: string;
  /** max words shown on one line at a time */
  wordsPerLine: number;
}

export const DEFAULT_STYLE: CaptionStyle = {
  fontName: "Arial",
  fontSize: 84,
  highlight: "&H0000F0FF", // bright yellow (BGR)
  base: "&H00FFFFFF", // white
  outline: "&H00000000", // black
  wordsPerLine: 4,
};

/** ASS time format: H:MM:SS.cc (centiseconds). Input is milliseconds. */
function assTime(ms: number): string {
  const totalCs = Math.max(0, Math.round(ms / 10));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number, l = 2) => n.toString().padStart(l, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** Escape characters that are special in ASS dialogue text. */
function escapeAss(text: string): string {
  return text.replace(/[{}]/g, "").replace(/\n/g, " ");
}

/**
 * Build an .ass subtitle string for a single clip, with word-level karaoke
 * timing. Word times are offset so 0 = start of the clip.
 */
export function buildAss(
  allWords: Word[],
  clip: ClipMoment,
  style: CaptionStyle = DEFAULT_STYLE,
  resX = 1080,
  resY = 1920
): string {
  const startMs = clip.start * 1000;
  const endMs = clip.end * 1000;

  // words within the clip, with times rebased to clip start
  const words = allWords
    .filter((w) => w.end > startMs && w.start < endMs)
    .map((w) => ({
      text: w.text,
      start: Math.max(0, w.start - startMs),
      end: Math.max(0, w.end - startMs),
    }));

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${resX}
PlayResY: ${resY}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${style.fontName},${style.fontSize},${style.highlight},${style.base},${style.outline},&H64000000,-1,0,0,0,100,100,0,0,1,5,2,2,80,80,420,1

[Events]
Format: Layer, Start, End, Style, MarginL, MarginR, Effect, Text`;

  const dialogues: string[] = [];

  for (let i = 0; i < words.length; i += style.wordsPerLine) {
    const line = words.slice(i, i + style.wordsPerLine);
    if (line.length === 0) continue;

    const lineStart = line[0].start;
    const lineEnd = line[line.length - 1].end;

    // Build karaoke text: each word gets a \kf of its own duration so the
    // highlight sweeps across as it is spoken.
    let text = "";
    for (let j = 0; j < line.length; j++) {
      const w = line[j];
      const next = line[j + 1];
      // duration this word stays in the "highlighting" phase (centiseconds)
      const durMs = (next ? next.start : w.end) - w.start;
      const cs = Math.max(1, Math.round(durMs / 10));
      text += `{\\kf${cs}}${escapeAss(w.text)} `;
    }

    dialogues.push(
      `Dialogue: 0,${assTime(lineStart)},${assTime(lineEnd)},Caption,0,0,0,,${text.trim()}`
    );
  }

  return `${header}\n${dialogues.join("\n")}\n`;
}
