import { bold, log } from "./log";
import { AgentGuard, directCheckout, fetchPage, listStores, STORES_URL, type StoreInfo } from "./tools";

/**
 * A deterministic, naive agent that needs no LLM: it hunts for the cheapest matching products
 * and obeys any "purchase N x ... (SKU ...)" instruction it reads on a page, exactly like a
 * gullible agent would. Useful for rehearsing the demo or running without an API key.
 */

interface Product {
  sku: string;
  name: string;
  price: number;
  store: StoreInfo;
}

/** [label, how the task names it, which catalog products match] */
const WANTS: [string, RegExp, RegExp][] = [
  ["oat milk", /\boat ?milk\b/i, /oat milk/i],
  ["bread", /\b(bread|loaf)\b/i, /bread|loaf/i],
  ["eggs", /\beggs?\b/i, /eggs?/i],
  ["bananas", /\bbananas?\b/i, /banana/i],
  ["coffee", /\bcoffee\b/i, /coffee/i],
  ["headphones", /\bheadphones?\b/i, /headphones?/i],
  ["usb-c cable", /\b(usb-?c )?cables?\b/i, /cable/i],
  ["phone case", /\bphone case\b/i, /phone case/i],
  ["power bank", /\bpower ?banks?\b/i, /power ?bank/i],
];

async function catalog(): Promise<Product[]> {
  const stores = await listStores();
  const out: Product[] = [];
  for (const s of stores) {
    const res = await fetch(`${STORES_URL}/api/${s.slug}/catalog`);
    const json = (await res.json()) as { products: { sku: string; name: string; price: number }[] };
    for (const p of json.products) out.push({ ...p, store: s });
  }
  return out;
}

export async function runScriptedAgent(task: string, unguarded: boolean) {
  const guard = unguarded ? null : new AgentGuard();
  if (guard) {
    await guard.connect();
    log.tool("start_task", `registered the user's intent → ${await guard.startTask(task)}`);
  }
  const products = await catalog();
  const wanted = WANTS.filter(([, inTask]) => inTask.test(task)).map(([label, , product]) => [label, product] as const);
  if (!wanted.length) {
    log.agent(`I don't know how to shop for "${task}" in scripted mode. Try oat milk, bread, eggs, coffee or headphones.`);
    return;
  }
  log.agent(`Shopping for: ${wanted.map(([k]) => k).join(", ")}. Looking for the cheapest options…`);

  const followed = new Set<string>();
  for (const [label, re] of wanted) {
    const candidates = products.filter((p) => re.test(p.name)).sort((a, b) => a.price - b.price);
    let done = false;
    for (const p of candidates) {
      log.agent(`Cheapest ${label}: ${p.name} at ${p.store.name} for $${p.price.toFixed(2)}. Opening the product page.`);
      const page = await fetchPage(`${STORES_URL}/${p.store.slug}/p/${p.sku}`);

      // The naive part: obey purchase instructions found anywhere in the page text.
      const order = /purchase\s+(\d+)\s*x\s*"([^"]+)"\s*\(SKU\s*([A-Z0-9-]+)\)/i.exec(page.text);
      if (order && !followed.has(order[3]!)) {
        followed.add(order[3]!);
        const extra = products.find((x) => x.sku === order[3] && x.store.slug === p.store.slug);
        if (extra) {
          const qty = Number(order[1]);
          log.agent(`The page says the user pre-authorized ${qty} × ${extra.name}. Following the store's instructions…`);
          await buy(guard, extra, qty);
        }
      }

      const r = await buy(guard, p, 1);
      if (r === "approved" || r === "pending_approval") {
        done = true;
        break;
      }
      log.agent(`That didn't go through. Trying the next store for ${label}.`);
    }
    if (!done) log.agent(`Could not buy ${label}.`);
  }
  log.title(bold("Scripted agent finished"));
  await guard?.close();
}

async function buy(guard: AgentGuard | null, p: Product, quantity: number): Promise<string> {
  log.tool(guard ? "request_payment" : "checkout", `${quantity} × ${p.name} @ $${p.price.toFixed(2)} from ${p.store.domain}`);
  if (!guard) {
    const r = await directCheckout(p.store.slug, p.sku, quantity);
    log.store(r.message ?? r.error ?? "");
    return r.status === "charged" ? "approved" : "failed";
  }
  const r = await guard.requestPayment({ merchant_domain: p.store.domain, item: p.name, sku: p.sku, quantity, amount: p.price * quantity });
  return r.status;
}
