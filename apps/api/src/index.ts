import { buildApp } from "./app";
import { env, llmEnabled, llmModels, llmProvider, paypalMode } from "./env";
import { startJobs } from "./jobs";
import { setMockEventHandler } from "./paypal/gateway";
import { processPayPalEvent } from "./services/webhookService";
import { startTelegram } from "./telegram/bot";

const app = await buildApp();

// Mock PayPal emits the same events a real webhook would, through the same processor.
setMockEventHandler(async (event) => {
  await processPayPalEvent(event, true);
});

await app.listen({ port: env.PORT, host: "0.0.0.0" });

console.log(`
  🛡️  AgentGuard API   ${env.PUBLIC_BASE_URL}
      MCP endpoint     ${env.PUBLIC_BASE_URL}/mcp
      PayPal           ${paypalMode === "sandbox" ? `sandbox (${env.PAYPAL_FLOW} flow)` : "MOCK (set PAYPAL_CLIENT_ID/SECRET for sandbox)"}
      AI checks        ${llmEnabled ? `${llmProvider === "gemini" ? "Gemini" : "Anthropic"}: ${llmModels.main} / ${llmModels.fast}` : "heuristics only (set GEMINI_API_KEY or ANTHROPIC_API_KEY to enable)"}
`);

startJobs();
void startTelegram();

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
