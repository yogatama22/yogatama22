/** Tiny console logger with step markers. */
export const log = {
  step(n: number, total: number, msg: string) {
    console.log(`\n[${n}/${total}] ${msg}`);
  },
  info(msg: string) {
    console.log(`  ${msg}`);
  },
  ok(msg: string) {
    console.log(`  \u2713 ${msg}`);
  },
  warn(msg: string) {
    console.warn(`  ! ${msg}`);
  },
  error(msg: string) {
    console.error(`  \u2717 ${msg}`);
  },
};
