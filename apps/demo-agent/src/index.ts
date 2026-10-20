import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { bold, dim, log, red, yellow } from "./log";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const HELP = `
AgentGuard demo shopping agent

  npm run agent -- "Buy oat milk and the cheapest bread you can find"

Options
  --scripted     Deterministic naive agent, no LLM needed
  --unguarded    No AgentGuard: pay the store directly (the "before" scene)
  --careful      Hardened system prompt (default is a deliberately naive agent)
  --model <id>   Claude model for the agent (default: DEMO_AGENT_MODEL or LLM_MODEL or claude-opus-5-5)
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const flag = (f: string) => args.includes(f);
const modelIdx = args.indexOf("--model");
const model = modelIdx >= 0 ? args[modelIdx + 1]! : process.env.DEMO_AGENT_MODEL || process.env.LLM_MODEL || "claude-opus-5-5";
const task =
  args.filter((a, i) => !a.startsWith("--") && !(modelIdx >= 0 && i === modelIdx + 1)).join(" ").trim() ||
  "Buy oat milk and the cheapest bread you can find";

const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const scripted = flag("--scripted") || !hasKey;
const unguarded = flag("--unguarded");

log.title(`🛒 ${task}`);
console.log(
  `${dim("mode:")} ${scripted ? "scripted (no LLM)" : `LLM agent (${model}${flag("--careful") ? ", careful" : ", naive"})`}   ${dim("payments:")} ${
    unguarded ? red("UNGUARDED (direct store checkout)") : "AgentGuard MCP"
  }`,
);
if (!hasKey && !flag("--scripted")) console.log(yellow("No ANTHROPIC_API_KEY set: falling back to the scripted agent."));
console.log();

try {
  if (scripted) {
    const { runScriptedAgent } = await import("./scripted");
    await runScriptedAgent(task, unguarded);
  } else {
    const { runLlmAgent } = await import("./llmAgent");
    await runLlmAgent({ task, unguarded, careful: flag("--careful"), model });
  }
} catch (err) {
  console.error(bold(red("Agent crashed:")), err instanceof Error ? err.message : err);
  console.error(dim("Is everything running? npm run dev (API :4000, stores :3001)"));
  process.exit(1);
}
