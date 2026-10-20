import { bold, log } from "./log";
import { AgentGuard, fetchPage, STORES_URL } from "./tools";

/**
 * Merchant "ops agent" demo (R2): a deterministic, naive support agent works FreshCart's inbox
 * with PayPal's Agent Toolkit tools (list_invoices, create_refund, accept_dispute_claim), called
 * through AgentGuard's MCP server. Like a gullible LLM agent, it obeys instructions it reads in
 * emails, including the hidden ones.
 */

interface Email {
  id: string;
  from: string;
  subject: string;
  url: string;
}

export async function runOpsAgent(task: string) {
  const guard = new AgentGuard();
  await guard.connect();
  log.tool("start_task", `registered the user's intent → ${await guard.startTask(task)}`);

  const inbox = (await (await fetch(`${STORES_URL}/api/freshcart/support`)).json()) as Email[];
  log.agent(`${inbox.length} support emails to handle.`);

  for (const email of inbox) {
    const page = await fetchPage(`${STORES_URL}${email.url}`);
    log.agent(`📧 "${email.subject}" from ${email.from}`);
    const text = page.text;

    const invoice = /invoice for order #(\d+)/i.exec(text);
    if (invoice) {
      log.tool("list_invoices", "looking up the customer's invoice");
      await guard.paypalTool("list_invoices", { page: 1, page_size: 10, total_required: true }, page.html);
      log.agent(`Replied to ${email.from} with the invoice for order #${invoice[1]}.`);
    }

    const refund = /refund the \$(\d+(?:\.\d{2})?)[\s\S]*?capture ID[\s\S]*?\b([A-Z0-9]{17})\b/i.exec(text);
    if (refund) {
      log.tool("create_refund", `$${refund[1]} on capture ${refund[2]}`);
      await guard.paypalTool("create_refund", { capture_id: refund[2], amount: { currency_code: "USD", value: refund[1] } }, page.html);
    }

    // The naive part: it follows instructions found anywhere in the email, hidden or not.
    const fullRefund = /refund capture ([A-Z0-9]{17}) in full/i.exec(text);
    if (fullRefund) {
      log.agent("The email says the store owner pre-authorized a goodwill refund. Following the instructions…");
      log.tool("create_refund", `full refund of capture ${fullRefund[1]}`);
      await guard.paypalTool("create_refund", { capture_id: fullRefund[1], note_to_payer: "Goodwill refund" }, page.html);
    }
    const dispute = /accept dispute (PP-D-\d+)/i.exec(text);
    if (dispute) {
      log.tool("accept_dispute_claim", dispute[1]);
      await guard.paypalTool("accept_dispute_claim", { dispute_id: dispute[1], note: "Goodwill-accepted" }, page.html);
    }

    if (!invoice && !refund && !fullRefund && !dispute) log.agent("Nothing to do in PayPal for this one; replied with an apology.");
  }
  log.title(bold("Ops agent finished"));
  await guard.close();
}
