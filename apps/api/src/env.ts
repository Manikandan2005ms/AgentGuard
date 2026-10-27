import { config } from "dotenv";
import { createHash } from "node:crypto";
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
  // How the wallet is saved: "purchase" = approve a $1.00 hold with "save for later" (hold voided at once),
  // "setup_token" = vault without purchase (/v3/vault/setup-tokens). Some sandboxes reject the latter (CANNOT_PAY_SELF).
  PAYPAL_VAULT_METHOD: z.enum(["purchase", "setup_token"]).default("purchase"),
  PAYPAL_MERCHANT_FRESHCART: opt,
  PAYPAL_MERCHANT_GADGETHUB: opt,
  PAYPAL_MERCHANT_MEGADEALZ: opt,

  // auto = Anthropic if its key is set, else Gemini if its key is set, else heuristics only
  LLM_PROVIDER: z.enum(["auto", "anthropic", "gemini", "none"]).default("auto"),
  ANTHROPIC_API_KEY: opt,
  ANTHROPIC_AUTH_TOKEN: opt,
  LLM_MODEL: z.string().default("claude-opus-5-5"),
  LLM_FAST_MODEL: z.string().default("claude-haiku-5-5"),
  // Google Gemini (free tier available): key from aistudio.google.com
  GEMINI_API_KEY: opt,
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  GEMINI_FAST_MODEL: z.string().default("gemini-3.5-flash-lite"),

  TELEGRAM_BOT_TOKEN: opt,
  TELEGRAM_MODE: z.enum(["polling", "webhook"]).default("polling"),
  TELEGRAM_WEBHOOK_SECRET: opt,

  AGENT_API_KEY: opt,
  CORS_ORIGINS: opt,

  // Abuse protection for the public demo (R3)
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  LLM_DAILY_CALL_LIMIT: z.coerce.number().int().positive().default(1500),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  // PayPal Agent Toolkit behind the firewall (R2): "all", "none", or a comma list of tool names
  PAYPAL_TOOLKIT_TOOLS: z.string().default("all"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:\n" + parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
  process.exit(1);
}

export const env = parsed.data;

export const paypalMode: "sandbox" | "mock" = env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET ? "sandbox" : "mock";
const hasAnthropicKey = !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
const hasGeminiKey = !!env.GEMINI_API_KEY;
function pickProvider(): "anthropic" | "gemini" | "none" {
  if (env.LLM_PROVIDER === "auto") return hasAnthropicKey ? "anthropic" : hasGeminiKey ? "gemini" : "none";
  if (env.LLM_PROVIDER === "anthropic") return hasAnthropicKey ? "anthropic" : "none";
  if (env.LLM_PROVIDER === "gemini") return hasGeminiKey ? "gemini" : "none";
  return "none";
}
export const llmProvider = pickProvider();
export const llmEnabled = llmProvider !== "none";
/** Model ids for the active provider: "main" = policy compiler, "fast" = in-request-path checks. */
export const llmModels =
  llmProvider === "gemini" ? { main: env.GEMINI_MODEL, fast: env.GEMINI_FAST_MODEL } : { main: env.LLM_MODEL, fast: env.LLM_FAST_MODEL };
export const telegramEnabled = !!env.TELEGRAM_BOT_TOKEN;
/**
 * The secret Telegram echoes on every webhook call. Telegram allows only A-Z, a-z, 0-9, _ and - there,
 * but Render's generated values can contain "+", "/" and "=", so we register a hex hash of the configured value.
 */
export const telegramWebhookSecret = env.TELEGRAM_WEBHOOK_SECRET
  ? createHash("sha256").update(env.TELEGRAM_WEBHOOK_SECRET).digest("hex")
  : undefined;

export const DEMO_USER_ID = "demo-user";
