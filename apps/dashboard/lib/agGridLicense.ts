/**
 * AG Grid / AG Charts Enterprise without a license key run in trial mode: a watermark, plus a
 * 7-line "License Key Not Found" banner printed with console.error on every grid. In development
 * Next.js counts each banner line as an error in its overlay, which buries real errors.
 *
 * Without a key, in development only, this swaps the banner for one info line. The watermark
 * stays, production consoles still show AG Grid's own banner, and with
 * NEXT_PUBLIC_AG_GRID_LICENSE_KEY set there is no banner to replace.
 * Import it before ag-grid-enterprise.
 */

const BANNER_LINE = /^\*.*\*$/;
const BANNER_WORDS = /^\*+$|License|trial|watermark|info@ag-grid\.com/i;

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY) {
  const original = console.error.bind(console);
  let noted = false;
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (args.length === 1 && typeof first === "string" && BANNER_LINE.test(first.trim()) && BANNER_WORDS.test(first)) {
      if (!noted) {
        noted = true;
        console.info("AG Grid / AG Charts Enterprise is in trial mode (watermark shown). Set NEXT_PUBLIC_AG_GRID_LICENSE_KEY to license it.");
      }
      return;
    }
    original(...args);
  };
}

export {};
