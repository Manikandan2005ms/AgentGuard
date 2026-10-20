import type { Period } from "@agentguard/shared";

/** Rolling budget windows: last 24 h / 7 d / 30 d. */
export const PERIOD_MS: Record<Period, number> = {
  day: 24 * 3600_000,
  week: 7 * 24 * 3600_000,
  month: 30 * 24 * 3600_000,
};
