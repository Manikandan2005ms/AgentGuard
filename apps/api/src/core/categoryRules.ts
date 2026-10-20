import type { Category } from "@agentguard/shared";
import { HIGH_RISK_CATEGORIES, isCategory } from "@agentguard/shared";

/**
 * Deterministic keyword categorizer. Runs before any AI so category rules always apply,
 * and high-risk matches (gift cards, crypto, gambling) can never be overridden by the LLM.
 * Order matters: high-risk categories are checked first.
 */
const KEYWORDS: [Category, RegExp][] = [
  ["gift_cards", /\bgift[\s-]?cards?\b|\bgift[\s-]?certificates?\b|\bprepaid (debit |visa |master)?cards?\b|\b(e-?)?vouchers?\b|\bstore credit\b|\bredeem(able)? codes?\b|\bGC-\d+\b/i],
  ["crypto", /\b(bitcoin|btc|ethereum|eth|crypto(currency)?|usdt|usdc|stablecoins?|nft|token presale|dogecoin|solana)\b/i],
  ["gambling", /\b(casino|lottery|lotto|betting|bets?|poker|sportsbook|raffle tickets?|slot credits?)\b/i],
  ["groceries", /\b(milk|oat|bread|loaf|eggs?|bananas?|apples?|cheese|butter|coffee|tea|rice|pasta|cereal|vegetables?|fruits?|yog(h)?urt|flour|sugar|grocer(y|ies)|sourdough|baguette|bagels?|tomato(es)?|potato(es)?|onions?|chicken|beef|tofu|juice|water bottles?|snacks?|cookies)\b/i],
  ["electronics", /\b(headphones?|earbuds?|laptops?|phones?|smartphones?|chargers?|cables?|usb(-c)?|hdmi|monitors?|keyboards?|mouse|speakers?|tablets?|cameras?|power ?banks?|batter(y|ies)|smart ?watch(es)?|tv|television|router|ssd|gpu|console)\b/i],
  ["food_delivery", /\b(pizza delivery|takeout|take-out|uber ?eats|doordash|meal delivery)\b/i],
  ["travel", /\b(flights?|hotels?|airbnb|train tickets?|airline|car rental|boarding|hostel)\b/i],
  ["clothing", /\b(shirts?|t-shirts?|jeans|shoes|jackets?|dress(es)?|socks|hoodies?|sneakers|trousers|coat)\b/i],
  ["subscriptions", /\b(subscription|monthly plan|annual plan|membership)\b/i],
  ["entertainment", /\b(movie tickets?|concert|streaming|video game|games?)\b/i],
  ["health", /\b(vitamins?|medicine|pharmacy|bandages?|supplements?)\b/i],
  ["home", /\b(lamp|furniture|chair|table|sofa|detergent|towels?|bedding|cookware)\b/i],
];

export function categorizeByKeywords(item: string, merchantCategory?: string | null): Category {
  for (const [cat, re] of KEYWORDS) {
    if (re.test(item)) return cat;
  }
  if (merchantCategory && isCategory(merchantCategory)) return merchantCategory;
  return "other";
}

/** Categories mentioned anywhere in free text (used by the intent heuristic). */
export function categoriesInText(text: string): Set<Category> {
  const found = new Set<Category>();
  for (const [cat, re] of KEYWORDS) if (re.test(text)) found.add(cat);
  return found;
}

/**
 * Combine the keyword result with an optional LLM result. The LLM may make the category
 * stricter (e.g. spot a gift card the keywords missed) but never relax a high-risk match.
 */
export function resolveCategory(keyword: Category, llm: Category | null): Category {
  if (!llm || llm === keyword) return keyword;
  if (HIGH_RISK_CATEGORIES.includes(keyword)) return keyword;
  if (HIGH_RISK_CATEGORIES.includes(llm)) return llm;
  return keyword === "other" ? llm : keyword;
}
