import { PrismaClient } from "@prisma/client";

/**
 * Supabase's free session pooler allows about 15 connections in total, while Prisma opens
 * CPUs × 2 + 1 by default. On Supabase we cap the pool (unless the URL sets connection_limit),
 * leaving room for a redeploy, when the old and new API and the migrations run side by side.
 */
export function datasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !/\.pooler\.supabase\.com/i.test(url) || /[?&]connection_limit=/i.test(url)) return undefined;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=5`;
}

export const prisma = new PrismaClient({ datasourceUrl: datasourceUrl() });
