import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Run an external binary and resolve with its output.
 * Streams nothing to the parent stdio; capture everything instead.
 */
export function run(
  bin: string,
  args: string[],
  opts: { cwd?: string } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `Could not find executable "${bin}". Is it installed and on your PATH (or set correctly in .env)?`
          )
        );
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `"${bin}" exited with code ${code}.\n${stderr || stdout}`.trim()
          )
        );
      }
    });
  });
}
