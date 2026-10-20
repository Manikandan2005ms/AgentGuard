import { z } from "zod";

export const CATEGORIES = [
  "groceries",
  "electronics",
  "gift_cards",
  "crypto",
  "gambling",
  "travel",
  "clothing",
  "home",
  "food_delivery",
  "entertainment",
  "subscriptions",
  "health",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CategorySchema = z.enum(CATEGORIES);

/** Categories that add risk points on their own (README §11.1). */
export const HIGH_RISK_CATEGORIES: readonly Category[] = ["gift_cards", "crypto", "gambling"];

export const CATEGORY_LABELS: Record<Category, string> = {
  groceries: "groceries",
  electronics: "electronics",
  gift_cards: "gift cards",
  crypto: "crypto",
  gambling: "gambling",
  travel: "travel",
  clothing: "clothing",
  home: "home goods",
  food_delivery: "food delivery",
  entertainment: "entertainment",
  subscriptions: "subscriptions",
  health: "health",
  other: "other",
};

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
