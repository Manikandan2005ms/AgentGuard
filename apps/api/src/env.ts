import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// One .env at the repo root is shared by every app.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
config();

const opt = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (see .env.example)"),
  PORT: z.coerce.number().default(4000),
  PUBLIC_BASE_URL: z.string().default("http://localhost:4000"),
  DASHBOARD_URL: z.string().default("http://localhost:3000"),
  STORES_URL: z.string().default("http://localhost:3001"),

  PAYPAL_CLIENT_ID: opt,
  PAYPAL_CLIENT_SECRET: opt,
  PAYPAL_BASE_URL: z.string().default("https://api-m.sandbox.paypal.com"),
  PAYPAL_WEBHOOK_ID: opt,
  PAYPAL_FLOW: z.enum(["vault", "approval_link"]).default("vault"),
  PAYPAL_MERCHANT_FRESHCART: opt,
  PAYPAL_MERCHANT_GADGETHUB: opt,
  PAYPAL_MERCHANT_MEGADEALZ: opt,

  LLM_PROVIDER: z.enum(["anthropic", "none"]).default("anthropic"),
  ANTHROPIC_API_KEY: opt,
  ANTHROPIC_AUTH_TOKEN: opt,
  LLM_MODEL: z.string().default("claude-opus-5-5"),
  LLM_FAST_MODEL: z.string().default("claude-haiku-5-5"),

  TELEGRAM_BOT_TOKEN: opt,
  TELEGRAM_MODE: z.enum(["polling", "webhook"]).default("polling"),
  TELEGRAM_WEBHOOK_SECRET: opt,

  AGENT_API_KEY: opt,
  CORS_ORIGINS: opt,
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:\n" + parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
  process.exit(1);
}

export const env = parsed.data;

export const paypalMode: "sandbox" | "mock" = env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET ? "sandbox" : "mock";
export const llmEnabled = env.LLM_PROVIDER === "anthropic" && !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
export const telegramEnabled = !!env.TELEGRAM_BOT_TOKEN;

export const DEMO_USER_ID = "demo-user";
