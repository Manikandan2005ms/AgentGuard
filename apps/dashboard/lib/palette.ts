/** The globals.css colour tokens, for canvas and JS-themed widgets (AG Charts, AG Grid) that can't read Tailwind classes. */
export const PALETTE = {
  paper: "#f3efe6",
  sheet: "#fbf9f4",
  ink: "#1d1c19",
  ink2: "#59554c",
  ink3: "#8a8578",
  rule: "#ddd6c6",
  rule2: "#c4bba7",
  accent: "#24408f",
  ok: "#2e6a3c",
  warn: "#995a0b",
  bad: "#ad3826",
  // Chart fills are a touch lighter than the text colours so large areas don't feel heavy.
  okFill: "#4f8a5b",
  warnFill: "#d0912f",
  badFill: "#c4553f",
  accentFill: "#3d5aa8",
} as const;

export const riskColor = (score: number) => (score >= 70 ? PALETTE.bad : score >= 35 ? PALETTE.warn : PALETTE.ok);
