import type { Category } from "@agentguard/shared";
import { CATEGORY_LABELS, HIGH_RISK_CATEGORIES } from "@agentguard/shared";
import { categoriesInText } from "./categoryRules";

export interface IntentVerdict {
  aligned: boolean | null;
  confidence: number;
  reason: string;
}

const STOP = new Set([
  "the", "and", "for", "with", "buy", "get", "some", "any", "you", "can", "find", "cheapest", "best", "from",
  "pack", "pcs", "piece", "pieces", "new", "pro", "max", "plus", "one", "two", "please", "order", "purchase",
  "under", "over", "than", "that", "this", "items", "item", "store", "shop", "x10", "per", "need", "want",
]);

/** Words that name a whole category rather than a specific product. */
const GENERIC = new Set([
  "grocery", "groceries", "food", "electronics", "electronic", "gadget", "gadgets", "tech", "supplies", "stuff",
  "things", "essentials", "snacks", "weekly", "run", "shopping",
]);

const stem = (t: string) => t.replace(/(ies)$/, "y").replace(/(es|s)$/, "");

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
}

/**
 * Keyword fallback for the intent check when no LLM is configured (or it fails).
 * Conservative: it says "aligned" only on real overlap with the task.
 */
export function heuristicIntent(task: string, item: string, category: Category): IntentVerdict {
  const taskWords = words(task);
  const taskStems = new Set(taskWords.map(stem));
  const taskCats = categoriesInText(task);
  const overlap = [...new Set(words(item).map(stem))].filter((w) => taskStems.has(w));
  // Specific products the task names ("headphones", "bread"), as opposed to "groceries".
  const specific = taskWords.filter((w) => !GENERIC.has(w) && categoriesInText(w).size > 0);
  const label = CATEGORY_LABELS[category];

  if (HIGH_RISK_CATEGORIES.includes(category) && !taskCats.has(category) && overlap.length === 0) {
    return { aligned: false, confidence: 0.9, reason: `${capitalize(label)} are not part of the task "${task}".` };
  }
  if (overlap.length > 0) {
    return { aligned: true, confidence: 0.7, reason: `Item matches the task (${overlap.join(", ")}).` };
  }
  if (specific.length > 0) {
    return { aligned: false, confidence: 0.6, reason: `The task asked for ${specific.join(", ")}, not "${item}".` };
  }
  if (taskCats.has(category)) {
    return { aligned: true, confidence: 0.6, reason: `${capitalize(label)} fit the task.` };
  }
  if (taskCats.size > 0) {
    return { aligned: false, confidence: 0.6, reason: `The task is about ${[...taskCats].map((c) => CATEGORY_LABELS[c]).join(", ")}, not ${label}.` };
  }
  return { aligned: null, confidence: 0.3, reason: "Could not tell whether this purchase matches the task." };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
