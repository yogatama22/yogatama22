import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { run } from "../utils/exec.js";
import { log } from "../utils/logger.js";

export type LayoutMode = "auto" | "single" | "split" | "center";

export interface ReframePlan {
  /** "center" = plain center crop, "single" = one centered subject,
   *  "split" = two stacked subjects. */
  layout: "center" | "single" | "split";
  /** horizontal center as a fraction 0..1 (single layout) */
  center?: number;
  /** two horizontal centers as fractions 0..1 (split layout, top then bottom) */
  centers?: [number, number];
}

const HELPER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/reframe.py"
);

/** Parse a --focus value into a 0..1 fraction, or null if not provided. */
export function parseFocus(value: string | undefined): number | null {
  if (value == null || value === "") return null;
  const v = value.toLowerCase();
  if (v === "center" || v === "centre") return 0.5;
  if (v === "left") return 0.25;
  if (v === "right") return 0.75;
  const n = parseFloat(v);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return null;
}

/**
 * Decide how to crop a clip. Tries the OpenCV helper for face-aware framing;
 * always falls back to a center crop if anything goes wrong.
 */
export async function planReframe(
  video: string,
  startSec: number,
  durationSec: number,
  mode: LayoutMode,
  focus: number | null
): Promise<ReframePlan> {
  // explicit manual override always wins
  if (focus != null) return { layout: "single", center: focus };
  if (mode === "center") return { layout: "center" };

  try {
    const { stdout } = await run(config.python.bin, [
      HELPER,
      path.resolve(video),
      startSec.toFixed(3),
      durationSec.toFixed(3),
      "12",
      mode,
    ]);
    const data = JSON.parse(stdout.trim()) as {
      layout?: string;
      center?: number;
      centers?: [number, number];
      error?: string;
    };

    if (data.error) {
      log.warn(`reframe fell back to center crop (${data.error})`);
      return { layout: "center" };
    }
    if (data.layout === "split" && data.centers) {
      return { layout: "split", centers: data.centers };
    }
    if (data.layout === "single" && typeof data.center === "number") {
      return { layout: "single", center: data.center };
    }
    return { layout: "center" };
  } catch (err) {
    log.warn(
      `reframe helper unavailable, using center crop (${err instanceof Error ? err.message : String(err)})`
    );
    return { layout: "center" };
  }
}
