import { EventEmitter } from "node:events";

/**
 * Emits every log line as a "line" event so a UI (e.g. the web server) can
 * stream pipeline progress, while still printing to the console for the CLI.
 */
export const logEvents = new EventEmitter();
logEvents.setMaxListeners(50);

function emit(line: string) {
  logEvents.emit("line", line);
}

/** Tiny console logger with step markers. */
export const log = {
  step(n: number, total: number, msg: string) {
    const line = `[${n}/${total}] ${msg}`;
    console.log(`\n${line}`);
    emit(line);
  },
  info(msg: string) {
    console.log(`  ${msg}`);
    emit(msg);
  },
  ok(msg: string) {
    console.log(`  \u2713 ${msg}`);
    emit(`\u2713 ${msg}`);
  },
  warn(msg: string) {
    console.warn(`  ! ${msg}`);
    emit(`! ${msg}`);
  },
  error(msg: string) {
    console.error(`  \u2717 ${msg}`);
    emit(`\u2717 ${msg}`);
  },
};
