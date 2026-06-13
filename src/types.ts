/** A single transcribed word with millisecond timing. */
export interface Word {
  text: string;
  /** start time in milliseconds */
  start: number;
  /** end time in milliseconds */
  end: number;
}

/** A clip moment chosen by the LLM. Times are in seconds. */
export interface ClipMoment {
  start: number;
  end: number;
  title: string;
  reason: string;
}

/** Options that drive the whole pipeline. */
export interface ClipOptions {
  input: string;
  outDir: string;
  workDir: string;
  topic: string;
  numClips: number;
  minDuration: number;
  maxDuration: number;
}
