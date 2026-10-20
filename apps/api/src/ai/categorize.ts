import { CATEGORIES, type Category } from "@agentguard/shared";
import { z } from "zod";
import { categorizeByKeywords, resolveCategory } from "../core/categoryRules";
import { structured } from "./llm";

/** README §9.4: item + merchant -> category, cached (README §22). */

const CategorySchemaOut = z.object({ category: z.enum(CATEGORIES) });
const cache = new Map<string, Category>();

const SYSTEM = `You classify a single product an AI agent wants to buy into exactly one spending category: ${CATEGORIES.join(", ")}.
Prepaid cards, vouchers, store credit and redeemable codes are gift_cards. Use "other" only if nothing fits.`;

export interface CategoryResult {
  category: Category;
  keyword: Category;
  llm: Category | null;
}

export async function categorize(item: string, merchantName: string, merchantCategory: string | null): Promise<CategoryResult> {
  const keyword = categorizeByKeywords(item, merchantCategory);
  const key = `${item.toLowerCase()}|${merchantName.toLowerCase()}`;
  let llm = cache.get(key) ?? null;
  if (!llm) {
    const res = await structured({
      name: "categorize",
      schema: CategorySchemaOut,
      tier: "fast",
      system: SYSTEM,
      user: `item: ${item}\nmerchant: ${merchantName}${merchantCategory ? ` (usually sells ${merchantCategory})` : ""}`,
    });
    if (res.ok) {
      llm = res.data.category;
      cache.set(key, llm);
    }
  }
  return { category: resolveCategory(keyword, llm), keyword, llm };
}
