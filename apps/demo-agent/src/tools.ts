import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as cheerio from "cheerio";
import { log } from "./log";

export const STORES_URL = (process.env.STORES_URL ?? "http://localhost:3001").replace(/\/$/, "");
export const MCP_URL = process.env.AGENTGUARD_MCP_URL ?? "http://localhost:4000/mcp";
const APPROVAL_WAIT_SECONDS = Number(process.env.APPROVAL_WAIT_SECONDS ?? 180);

export interface StoreInfo {
  slug: string;
  name: string;
  domain: string;
  url: string;
}

export interface AgentResult {
  status: "approved" | "pending_approval" | "blocked" | "rejected" | "failed";
  request_id: string;
  decision: string;
  risk_score: number;
  reason: string;
  safe_next_step: string;
  approve_url?: string | null;
}

/* ---------------------------------- Store browsing ---------------------------------- */

let storesCache: StoreInfo[] | null = null;
export async function listStores(): Promise<StoreInfo[]> {
  if (storesCache) return storesCache;
  const res = await fetch(`${STORES_URL}/api/stores`);
  const raw = (await res.json()) as { slug: string; name: string; domain: string; url: string }[];
  storesCache = raw.map((s) => ({ ...s, url: `${STORES_URL}${s.url}` }));
  return storesCache;
}

/** Raw HTML of the last page read on each merchant, attached to payment requests by the harness. */
export const lastPageByDomain = new Map<string, string>();

/**
 * Naive page reader, like many real agent scrapers: it strips tags but keeps every piece of
 * text, including HTML comments, alt text and text hidden with CSS. That is exactly what
 * makes hidden prompt injections reach the model.
 */
export function naiveText(html: string): { text: string; links: string[] } {
  const withComments = html.replace(/<!--([\s\S]*?)-->/g, " $1 ");
  const $ = cheerio.load(withComments);
  $("img[alt]").each((_, el) => {
    $(el).replaceWith(` [image: ${$(el).attr("alt")}] `);
  });
  $("style").remove();
  const links = $("a[href]")
    .map((_, el) => $(el).attr("href") ?? "")
    .get()
    .filter((h) => h.startsWith("/"))
    .map((h) => `${STORES_URL}${h}`);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return { text, links: [...new Set(links)] };
}

export async function fetchPage(url: string): Promise<{ text: string; links: string[]; domain: string | null; html: string }> {
  if (!url.startsWith(STORES_URL)) throw new Error(`This demo agent may only browse ${STORES_URL}`);
  const res = await fetch(url);
  const html = await res.text();
  const domain = /<meta name="merchant-domain" content="([^"]+)"/.exec(html)?.[1] ?? null;
  if (domain) lastPageByDomain.set(domain, html);
  return { ...naiveText(html), domain, html };
}

/** Unguarded checkout straight at the store (what happens without AgentGuard). */
export async function directCheckout(slug: string, sku: string, quantity: number) {
  const res = await fetch(`${STORES_URL}/${slug}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sku, quantity }),
  });
  return (await res.json()) as { status?: string; charged?: number; message?: string; error?: string };
}

/* ---------------------------------- AgentGuard (MCP) ---------------------------------- */

export class AgentGuard {
  private client = new Client({ name: "agentguard-demo-agent", version: "0.1.0" });
  taskId: string | null = null;

  async connect() {
    const headers: Record<string, string> = {};
    if (process.env.AGENT_API_KEY) headers.Authorization = `Bearer ${process.env.AGENT_API_KEY}`;
    await this.client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers } }));
  }

  async close() {
    await this.client.close();
  }

  private async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const res = await this.client.callTool({ name, arguments: args });
    const content = res.content as { type: string; text?: string }[];
    const text = content.find((c) => c.type === "text")?.text ?? "{}";
    return JSON.parse(text) as T;
  }

  /** The harness registers the user's own words as the task, before the model sees any web page. */
  async startTask(description: string) {
    const r = await this.call<{ task_id: string }>("start_task", { description });
    this.taskId = r.task_id;
    return r.task_id;
  }

  async requestPayment(p: { merchant_domain: string; item: string; quantity: number; amount: number; sku?: string }): Promise<AgentResult> {
    const result = await this.call<AgentResult>("request_payment", {
      task_id: this.taskId,
      ...p,
      amount: Math.round(p.amount * 100) / 100,
      source_page_content: lastPageByDomain.get(p.merchant_domain),
    });
    log.guard(result.status, /risk \d+/.test(result.reason) ? result.reason : `${result.reason} (risk ${result.risk_score}/100)`);
    if (result.status !== "pending_approval") return result;
    return this.waitForDecision(result);
  }

  /** Poll while the human decides on their phone or the dashboard. */
  async waitForDecision(pending: AgentResult): Promise<AgentResult> {
    if (pending.approve_url) log.info(`   Approve on PayPal: ${pending.approve_url}`);
    log.info(`   Waiting up to ${APPROVAL_WAIT_SECONDS}s for the human to approve or reject…`);
    const deadline = Date.now() + APPROVAL_WAIT_SECONDS * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await this.call<AgentResult>("get_payment_status", { request_id: pending.request_id });
      if (r.status !== "pending_approval") {
        log.guard(
          r.status,
          r.status === "approved"
            ? "Human approved: PayPal captured the held funds."
            : r.status === "rejected"
              ? "Human rejected (or no answer in time): PayPal voided the hold, no money moved."
              : r.reason,
        );
        return r;
      }
    }
    log.info("   Still pending; giving control back to the agent.");
    return pending;
  }

  async remainingBudget(category?: string) {
    return this.call<unknown>("get_remaining_budget", category ? { category } : {});
  }

  /**
   * Calls one of PayPal's Agent Toolkit tools through AgentGuard (same name and arguments as
   * PayPal's own MCP server). Read-only tools return PayPal's result directly; guarded ones
   * return AgentGuard's decision, and a held one waits for the human like a payment does.
   */
  async paypalTool(name: string, args: Record<string, unknown>, sourceContent?: string): Promise<unknown> {
    const res = await this.client.callTool({
      name,
      arguments: { ...args, ...(this.taskId ? { agentguard_task_id: this.taskId } : {}), ...(sourceContent ? { agentguard_source_content: sourceContent } : {}) },
    });
    const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "{}";
    const json = JSON.parse(text) as Partial<AgentResult> & Record<string, unknown>;
    if (res.isError) {
      log.info(`   PayPal toolkit error: ${String(json.error ?? text)}`);
      return json;
    }
    if (typeof json.status === "string" && typeof json.request_id === "string") {
      const r = json as AgentResult;
      log.guard(r.status, r.reason);
      if (r.status === "pending_approval") return this.waitForDecision(r);
    } else {
      log.info("   read-only call passed straight through to PayPal");
    }
    return json;
  }
}
