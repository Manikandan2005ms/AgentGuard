import type { Category, Policy } from "@agentguard/shared";
import { emptyPolicy } from "@agentguard/shared";

/**
 * Deterministic fallback policy compiler for common phrasings, used when no LLM is configured
 * or the LLM output fails validation twice. Anything it does not understand is reported back
 * as a clarification instead of being guessed.
 */

const CATEGORY_WORDS: [RegExp, Category][] = [
  [/gift[\s-]?cards?|gift certificates?|vouchers?/, "gift_cards"],
  [/crypto(currency|currencies)?|bitcoin|nfts?/, "crypto"],
  [/gambling|betting|casinos?|lotter(y|ies)/, "gambling"],
  [/groceries|grocery|food shopping|supermarket/, "groceries"],
  [/electronics|gadgets?|tech/, "electronics"],
  [/travel|flights?|hotels?/, "travel"],
  [/cloth(es|ing)|fashion|apparel/, "clothing"],
  [/food delivery|takeout|take-out/, "food_delivery"],
  [/subscriptions?/, "subscriptions"],
  [/entertainment|games?|movies?/, "entertainment"],
  [/home goods|furniture/, "home"],
  [/health|pharmacy|medicine/, "health"],
];

function categoriesIn(text: string): Category[] {
  const found: Category[] = [];
  for (const [re, cat] of CATEGORY_WORDS) if (re.test(text) && !found.includes(cat)) found.push(cat);
  return found;
}

const NUM = String.raw`\$?\s*(\d+(?:[.,]\d{1,2})?)`;
const toNum = (s: string) => Number(s.replace(",", "."));

function to24h(h: number, m: number, ampm?: string): string {
  let hh = h % 12;
  if (!ampm) hh = h;
  else if (ampm.toLowerCase() === "pm") hh += 12;
  return `${String(hh).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface RuleCompileResult {
  policy: Policy;
  understood: string[];
  clarifications: string[];
}

export function compilePolicyWithRules(raw: string): RuleCompileResult {
  const p = emptyPolicy();
  const understood: string[] = [];
  const clarifications: string[] = [];
  const sentences = raw
    .replace(/[’‘]/g, "'")
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.trim().replace(/[.;!?]+$/, ""))
    .filter(Boolean);

  for (const sentence of sentences) {
    const s = sentence.toLowerCase();
    let matched = false;

    // "Max $150 a week on groceries", "spend at most $600 per month"
    const budget = new RegExp(
      String.raw`(?:max(?:imum)?|up to|no more than|at most|limit(?: of)?|budget(?: of)?|spend(?:ing)?(?: (?:limit|cap))?(?: of)?(?: at most)?)\s*${NUM}\s*(?:dollars|usd|bucks)?\s*(?:a|per|each|every|/)\s*(day|week|month)(?:\s*(?:on|for)\s+(.+))?`,
    ).exec(s);
    if (budget) {
      const cats = budget[3] ? categoriesIn(budget[3]) : [];
      const limit = toNum(budget[1]!);
      const period = budget[2] as "day" | "week" | "month";
      if (cats.length) for (const c of cats) p.budgets.push({ category: c, period, limit });
      else p.budgets.push({ category: "*", period, limit });
      understood.push(sentence);
      matched = true;
    }

    // "Ask me before anything over $50"
    const approval = new RegExp(
      String.raw`(?:ask|check with|confirm with|ping|notify) me(?: first)? (?:before|for|on|about|if)?\s*(?:anything|any purchase|purchases|payments?|spending|it costs|buying anything)?\s*(?:that'?s |that is |costing )?(?:over|above|more than|exceeding|greater than|>)\s*${NUM}`,
    ).exec(s);
    if (approval) {
      p.require_approval_above = toNum(approval[1]!);
      understood.push(sentence);
      matched = true;
    }

    // "Never spend more than $200 on a single purchase"
    const perTx = new RegExp(
      String.raw`(?:never|don'?t|do not|no)\s+(?:spend|pay|purchases?|orders?|buy anything)?\s*(?:more than|over|above|exceeding)\s*${NUM}(?!\d|\s*(?:purchases|transactions|payments|orders|times))\s*(?:on |for |in )?(?:a |one |any )?(?:single |one )?(?:purchase|transaction|order|item|payment)?`,
    ).exec(s);
    if (perTx && !budget && !approval) {
      p.per_transaction_limit = toNum(perTx[1]!);
      understood.push(sentence);
      matched = true;
    }

    // "Don't pay merchants younger than 30 days"
    const age = /(?:merchants?|stores?|shops?|sites?|sellers?)\s+(?:that are\s+)?(?:younger|newer|less than)\s+(?:than\s+)?(\d+)\s*(day|week|month|year)s?/.exec(s);
    if (age) {
      const n = Number(age[1]);
      const mult = { day: 1, week: 7, month: 30, year: 365 }[age[2] as "day" | "week" | "month" | "year"];
      p.merchant_rules.min_merchant_age_days = n * mult;
      understood.push(sentence);
      matched = true;
    }

    // "Electronics only from stores I've used before"
    const trusted = /(.+?)\s+only from (?:stores?|merchants?|shops?|sites?|sellers?) (?:i(?:'ve| have)|i've) (?:used|bought from|shopped (?:at|with)|paid)(?: before)?/.exec(s);
    if (trusted) {
      const cats = categoriesIn(trusted[1]!);
      if (cats.length) {
        for (const c of cats) if (!p.merchant_rules.trusted_only_categories.includes(c)) p.merchant_rules.trusted_only_categories.push(c);
        understood.push(sentence);
        matched = true;
      }
    }

    // "Ask me before buying from a new store"
    if (/(?:ask|check with|confirm with) me .*\bnew (?:merchants?|stores?|shops?|sites?|sellers?)/.test(s)) {
      p.merchant_rules.new_merchant_requires_approval = true;
      understood.push(sentence);
      matched = true;
    }

    // "Never buy from megadealz.example"
    const blockDomain = /(?:never|don'?t|do not)\s+(?:buy|pay|shop|purchase)\s+(?:anything\s+)?(?:from|at|on)\s+([a-z0-9-]+(?:\.[a-z0-9-]+)+)/.exec(s);
    if (blockDomain) {
      p.merchant_rules.blocklist.push(blockDomain[1]!);
      understood.push(sentence);
      matched = true;
    }

    // "Always trust freshcart.example"
    const allowDomain = /(?:always\s+)?(?:trust|allow|whitelist|allowlist)\s+([a-z0-9-]+(?:\.[a-z0-9-]+)+)/.exec(s);
    if (allowDomain) {
      p.merchant_rules.allowlist.push(allowDomain[1]!);
      understood.push(sentence);
      matched = true;
    }

    // "Never buy gift cards", "no crypto or gambling"
    if (!matched && /^(?:never|don'?t|do not|no|block|ban)\b/.test(s)) {
      const cats = categoriesIn(s);
      if (cats.length) {
        for (const c of cats) if (!p.blocked_categories.includes(c)) p.blocked_categories.push(c);
        understood.push(sentence);
        matched = true;
      }
    }

    // "No more than 5 purchases per hour"
    const vel = /(?:no more than|at most|max(?:imum)?|only)\s+(\d+)\s+(?:purchases|transactions|payments|orders)\s+(?:per|an?|every|in (?:an?|one))\s*(?:(\d+)\s*)?(hour|minute|day)s?/.exec(s);
    if (vel) {
      const n = Number(vel[2] ?? 1);
      const unit = { minute: 1, hour: 60, day: 1440 }[vel[3] as "minute" | "hour" | "day"];
      p.velocity = { max_transactions: Number(vel[1]), window_minutes: n * unit };
      understood.push(sentence);
      matched = true;
    }

    // "Ask me for anything between 11pm and 7am"
    const quiet = /(?:between|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:and|to|-|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(s);
    if (quiet && /(ask|block|no |don'?t|never|quiet)/.test(s)) {
      const start = to24h(Number(quiet[1]), Number(quiet[2] ?? 0), quiet[3] ?? quiet[6]);
      const end = to24h(Number(quiet[4]), Number(quiet[5] ?? 0), quiet[6]);
      p.time_rules.quiet_hours = { start, end, action: /\bask\b/.test(s) ? "ask" : "block" };
      understood.push(sentence);
      matched = true;
    }

    // "Cancel approvals after 10 minutes"
    const timeout = /(?:cancel|void|expire|time ?out)\b.*?(?:after|in)\s+(\d+)\s*min/.exec(s);
    if (timeout) {
      p.approval_timeout_minutes = Number(timeout[1]);
      understood.push(sentence);
      matched = true;
    }

    if (!matched) clarifications.push(`I couldn't turn this into a rule: "${sentence}"`);
  }

  p.clarifications = clarifications;
  return { policy: p, understood, clarifications };
}
