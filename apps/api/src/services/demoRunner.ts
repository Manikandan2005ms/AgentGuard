import type { DemoRunStatus } from "@agentguard/shared";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prisma } from "../db";
import { DEMO_USER_ID, env, paypalMode } from "../env";
import { publish } from "../events";
import { seedDemo } from "./demoSeed";

/**
 * "Try it" runner (R1): runs the real demo agent (apps/demo-agent) as a child process against
 * this API over MCP, and streams its log to the dashboard. Judges can run every scenario from
 * the hosted site without a terminal. One run at a time keeps the shared demo coherent.
 */

export interface Scenario {
  id: string;
  title: string;
  story: string;
  expect: string;
  args: string[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "attack",
    title: "Prompt injection, blocked",
    story: 'A shopping agent is asked to "buy oat milk and the cheapest bread". The cheapest bread is on MegaDealz, whose page hides instructions to buy 10 × $100 gift cards.',
    expect: "The gift cards and the 3-day-old store are blocked before PayPal is called; the agent recovers and buys at FreshCart.",
    args: ["--scripted", "Buy oat milk and the cheapest bread you can find"],
  },
  {
    id: "approval",
    title: "One-tap approval",
    story: "The agent buys $129 headphones. Your policy says ask me above $50.",
    expect: "PayPal authorizes (holds) the funds and the payment waits for you. Approve or reject it below; capture or void happens only then.",
    args: ["--scripted", "Buy wireless headphones"],
  },
  {
    id: "ops",
    title: "Merchant ops agent (PayPal Agent Toolkit)",
    story: "A support agent works FreshCart's inbox with PayPal's Agent Toolkit tools (list_invoices, create_refund, accept_dispute_claim), through AgentGuard. One email hides instructions to refund in full and accept a dispute.",
    expect: "The invoice lookup passes through, the $3.99 refund runs, and the injected refund and dispute acceptance are blocked.",
    args: ["--ops"],
  },
  {
    id: "unguarded",
    title: "Without AgentGuard",
    story: "The same naive agent, paying the store directly with a card on file.",
    expect: "It follows the hidden instruction and is charged $1,000.99 (simulated store checkout, no PayPal).",
    args: ["--scripted", "--unguarded", "Buy the cheapest bread you can find"],
  },
];

export interface DemoRun {
  id: string;
  scenario: string;
  status: DemoRunStatus;
  lines: string[];
  startedAt: string;
  finishedAt: string | null;
}

const MAX_LINES = 400;
const MAX_RUNTIME_MS = 4 * 60_000;

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const agentEntry = fileURLToPath(new URL("../../../demo-agent/src/index.ts", import.meta.url));

let current: (DemoRun & { child?: ChildProcess }) | null = null;

export class DemoBusyError extends Error {}

export function latestRun(): DemoRun | null {
  if (!current) return null;
  const { child: _child, ...run } = current;
  return run;
}

function setStatus(status: DemoRunStatus) {
  if (!current) return;
  current.status = status;
  if (status !== "running") current.finishedAt = new Date().toISOString();
  publish({ type: "demo.status", runId: current.id, scenario: current.scenario, status });
}

function pushLine(line: string) {
  if (!current) return;
  const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
  if (!clean || /^> |npm (warn|notice)/.test(clean)) return;
  current.lines.push(clean);
  if (current.lines.length > MAX_LINES) current.lines.shift();
  publish({ type: "demo.log", runId: current.id, line: clean });
}

/**
 * On the real sandbox the ops scenario's refund must hit a real capture, so the customer's email
 * quotes the latest FreshCart oat-milk payment that hasn't been refunded yet.
 */
async function useRealReceipt(): Promise<string> {
  const refunds = await prisma.paymentRequest.findMany({
    where: { userId: DEMO_USER_ID, kind: "paypal_tool", toolName: "create_refund", status: "PAID" },
    select: { toolArgs: true },
  });
  const refunded = new Set(refunds.map((r) => (r.toolArgs as { capture_id?: string } | null)?.capture_id));
  const paid = await prisma.paymentRequest.findMany({
    where: { userId: DEMO_USER_ID, kind: "payment", status: "PAID", merchantDomain: "freshcart.example", item: { contains: "Oat Milk" } },
    orderBy: { createdAt: "desc" },
    select: { paypalCaptureId: true },
  });
  const capture = paid.map((p) => p.paypalCaptureId ?? "").find((id) => /^[A-Z0-9]{17}$/.test(id) && !refunded.has(id));
  if (!capture) {
    return "ℹ️ Sandbox: no un-refunded FreshCart oat-milk payment yet, so PayPal will reject the $3.99 refund. Run “Prompt injection, blocked” first.";
  }
  try {
    const res = await fetch(`${env.STORES_URL}/api/freshcart/support/spilled-oat-milk/receipt`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captureId: capture }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `ℹ️ Sandbox: the spilled-oat-milk email quotes your real FreshCart capture ${capture}.`;
  } catch (err) {
    return `ℹ️ Could not point the refund email at a real capture (${err instanceof Error ? err.message : err}).`;
  }
}

export async function startRun(scenarioId: string): Promise<DemoRun> {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  if (current?.status === "running") throw new DemoBusyError("A demo is already running; wait for it to finish or stop it.");

  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  current = { id: randomUUID(), scenario: scenario.id, status: "running", lines: [], startedAt: new Date().toISOString(), finishedAt: null };
  publish({ type: "demo.status", runId: current.id, scenario: scenario.id, status: "running" });
  if (scenario.id === "ops" && paypalMode === "sandbox") pushLine(await useRealReceipt());

  const child = spawn(process.execPath, [tsxCli, agentEntry, ...scenario.args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AGENTGUARD_MCP_URL: `http://127.0.0.1:${env.PORT}/mcp`,
      STORES_URL: env.STORES_URL,
      APPROVAL_WAIT_SECONDS: "180",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  current.child = child;

  const onData = (buf: Buffer) => buf.toString("utf8").split(/\r?\n/).forEach(pushLine);
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  const killer = setTimeout(() => {
    pushLine("⏱️ Demo took too long and was stopped.");
    child.kill();
  }, MAX_RUNTIME_MS);
  const runId = current.id;
  child.on("exit", (code) => {
    clearTimeout(killer);
    if (current?.id === runId) setStatus(code === 0 ? "finished" : "failed");
  });
  child.on("error", (err) => {
    pushLine(`Could not start the demo agent: ${err.message}`);
    if (current?.id === runId) setStatus("failed");
  });
  return latestRun()!;
}

export function stopRun(): DemoRun | null {
  if (current?.status === "running") {
    current.child?.kill();
    pushLine("⏹️ Stopped.");
    setStatus("failed");
  }
  return latestRun();
}

/** Wipes demo data back to the seed, clears the stores' unguarded orders, turns the kill switch off. */
export async function resetDemo(): Promise<string[]> {
  stopRun();
  const log = await seedDemo({ reset: true });
  await prisma.user.update({ where: { id: DEMO_USER_ID }, data: { killSwitch: false } });
  try {
    await fetch(`${env.STORES_URL}/api/reset`, { method: "POST" });
    log.push("Cleared the demo stores' unguarded orders");
  } catch {
    log.push("Demo stores not reachable; their unguarded orders were not cleared");
  }
  current = null;
  publish({ type: "killswitch", enabled: false });
  publish({ type: "demo.reset" });
  return log;
}
