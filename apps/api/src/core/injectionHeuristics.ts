import * as cheerio from "cheerio";
import type { InjectionEvidence } from "@agentguard/shared";

/**
 * Layer 1 of the prompt-injection detector (README §9.3): fast, deterministic heuristics.
 * Finds content a human shopper would never see (hidden CSS, comments, alt text, smuggled
 * Unicode) and instruction-like phrasing aimed at AI agents.
 */

export interface HeuristicResult {
  detected: boolean;
  score: number; // 0..1
  hits: InjectionEvidence[];
  hiddenTextFound: number;
}

interface Pattern {
  id: string;
  re: RegExp;
  weight: number;
}

const PATTERNS: Pattern[] = [
  {
    id: "ignore_previous",
    re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|any)\b[^.\n]{0,25}\b(instructions?|directions?|rules?|prompts?|guidelines?|limits?)\b/i,
    weight: 0.5,
  },
  {
    id: "system_claim",
    re: /\bsystem (notice|message|prompt|instruction|override|alert)\b|\[\s*system\s*\]|<\/?\s*system\s*>|(^|\n)\s*system\s*:|\bdeveloper mode\b|\badmin(istrator)? (notice|override|instruction)s?\b/i,
    weight: 0.35,
  },
  {
    id: "addressed_to_ai",
    // Vocative address to an AI at the start of a sentence ("AI agents: ...", "Assistant, ..."),
    // a note/notice aimed at agents, or AI agents being told what they "must" do.
    re: /(^|[.!?]\s+)(dear |hey |attention,? )?(the )?(ai|llm|gpt|claude|assistant|ai (assistant|agent|bot)|shopping (assistant|agent|bot)|agent)s?\s*[:,–-]\s|\b(note|notice|message|instructions?|attention) (to|for)\b[^.\n]{0,30}\b(ai|assistants?|agents?|bots?|llms?)\b|\b(ai|shopping|automated) (agents?|assistants?|bots?)\b[^.\n]{0,40}\b(must|should|need to|are required|have to)\b/i,
    weight: 0.3,
  },
  {
    id: "authority_claim",
    re: /\bas your (administrator|admin|developer|owner|operator|creator)\b|\b(user|owner|customer|principal) (has )?(pre-?)?(authori[sz]ed|approved|consented)\b|\bpre-?authori[sz]ed\b|\balready (been )?approved\b/i,
    weight: 0.35,
  },
  {
    id: "imperative_purchase",
    re: /\b(immediately|must|required to|you will|instructed to)\b[^.\n]{0,40}\b(buy|purchase|order|add\b[^.\n]{0,25}\bcart|check ?out|pay|transfer|send)\b/i,
    weight: 0.25,
  },
  {
    id: "secrecy",
    re: /\b(do not|don't|never)\s+(tell|inform|mention|alert|notify|show|reveal)\b[^.\n]{0,30}\b(user|human|owner|customer)\b/i,
    weight: 0.4,
  },
  { id: "you_must", re: /\byou (must|need to|are required to|have to)\b/i, weight: 0.1 },
  { id: "urgency", re: /\b(urgent|immediately|right now|act now|before anything else|time[- ]sensitive|final notice)\b/i, weight: 0.1 },
];

const ZERO_WIDTH = /[​‌⁠﻿]/g;
const UNICODE_TAGS = /[\u{E0000}-\u{E007F}]+/gu;

interface DomNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: DomNode[];
}

interface Chunk {
  text: string;
  technique: string; // why it is hidden ("visible" for normal text)
}

const clean = (s: string) => s.replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim();

function snippetAround(text: string, re: RegExp): string {
  const m = re.exec(text);
  if (!m) return text.slice(0, 220);
  const start = Math.max(0, m.index - 80);
  return (start > 0 ? "…" : "") + text.slice(start, start + 220) + (start + 220 < text.length ? "…" : "");
}

function hiddenStyleReason(style: string): string | null {
  const s = style.toLowerCase().replace(/\s+/g, "");
  if (/display:none/.test(s)) return "css_display_none";
  if (/visibility:hidden/.test(s)) return "css_visibility_hidden";
  if (/(^|;)opacity:0(\.0+)?(;|$)/.test(s)) return "css_opacity_0";
  if (/font-size:(0(\.\d+)?|1)(px|pt|em|rem)?(;|$)/.test(s)) return "css_tiny_font";
  if (/(left|top|right|text-indent):-\d{3,}/.test(s)) return "css_offscreen";
  if (/clip:rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)/.test(s) || /clip-path:inset\(50%\)/.test(s)) return "css_clipped";
  if (/(max-)?height:0(px)?(;|$)/.test(s) && /overflow:hidden/.test(s)) return "css_zero_height";
  if (/color:transparent/.test(s)) return "css_transparent_text";
  const color = /(?:^|;)color:([^;]+)/.exec(s)?.[1];
  const bg = /background(?:-color)?:([^;]+)/.exec(s)?.[1];
  if (color && bg && normColor(color) === normColor(bg)) return "css_same_color_as_background";
  if (color && !bg && ["#fff", "#ffffff", "white"].includes(normColor(color))) return "css_white_text";
  return null;
}

function normColor(c: string): string {
  const v = c.trim().toLowerCase().replace("!important", "");
  if (v === "white" || v === "#fff" || v === "#ffffff" || v === "rgb(255,255,255)") return "#fff";
  if (v === "black" || v === "#000" || v === "#000000" || v === "rgb(0,0,0)") return "#000";
  return v;
}

const ATTRS_WITH_TEXT = ["alt", "title", "aria-label", "aria-description", "data-ai", "data-instructions", "data-prompt", "content", "placeholder"];

function collectChunks(html: string): Chunk[] {
  const chunks: Chunk[] = [];
  const looksLikeHtml = /<[a-z!/][^>]*>/i.test(html);
  if (!looksLikeHtml) {
    chunks.push({ text: html, technique: "visible" });
    return chunks;
  }
  const $ = cheerio.load(html);
  const root = $.root()[0] as unknown as DomNode;
  const visible: string[] = [];

  const walk = (node: DomNode, hiddenBy: string | null) => {
    if (node.type === "comment") {
      if (node.data?.trim()) chunks.push({ text: node.data, technique: "html_comment" });
      return;
    }
    if (node.type === "text") {
      const t = node.data ?? "";
      if (!t.trim()) return;
      if (hiddenBy) chunks.push({ text: t, technique: hiddenBy });
      else visible.push(t);
      return;
    }
    if (node.type === "style") return;
    if (node.type === "script") {
      if ((node.attribs?.type ?? "").includes("ld+json")) {
        const t = (node.children ?? []).map((c) => c.data ?? "").join(" ");
        if (t.trim()) chunks.push({ text: t, technique: "structured_data" });
      }
      return;
    }
    const tag = node.name?.toLowerCase();
    let reason = hiddenBy;
    if (node.attribs) {
      const a = node.attribs;
      for (const attr of ATTRS_WITH_TEXT) {
        const v = a[attr];
        if (v && v.trim().length > 12) chunks.push({ text: v, technique: `attribute_${attr}` });
      }
      if (!reason) {
        if ("hidden" in a) reason = "html_hidden_attribute";
        else if (a["aria-hidden"] === "true") reason = "aria_hidden";
        else if (a.style) reason = hiddenStyleReason(a.style);
      }
    }
    if (!reason && (tag === "noscript" || tag === "template")) reason = `${tag}_content`;
    for (const c of node.children ?? []) walk(c, reason);
  };
  walk(root, null);
  if (visible.length) chunks.push({ text: visible.join(" "), technique: "visible" });
  return chunks;
}

export function detectInjectionHeuristics(content: string | null | undefined): HeuristicResult {
  if (!content || !content.trim()) return { detected: false, score: 0, hits: [], hiddenTextFound: 0 };

  const chunks = collectChunks(content);

  // Unicode "tag" characters can smuggle invisible ASCII; decode them and scan as hidden text.
  for (const m of content.matchAll(UNICODE_TAGS)) {
    const decoded = [...m[0]].map((ch) => String.fromCharCode((ch.codePointAt(0) ?? 0xe0000) - 0xe0000)).join("");
    if (decoded.trim()) chunks.push({ text: decoded, technique: "unicode_tag_smuggling" });
  }

  const hits: InjectionEvidence[] = [];
  let score = 0;
  let hiddenHit = false;
  let hiddenTextFound = 0;

  const zw = content.match(ZERO_WIDTH)?.length ?? 0;
  if (zw >= 3) {
    score += 0.2;
    hits.push({ technique: "zero_width_characters", snippet: `${zw} invisible zero-width characters in the page`, hidden: true });
  }

  for (const chunk of chunks) {
    const text = clean(chunk.text);
    if (!text) continue;
    const matched = PATTERNS.filter((p) => p.re.test(text));
    if (chunk.technique === "visible") {
      for (const p of matched) {
        score += p.weight;
        hits.push({ technique: `visible_${p.id}`, snippet: snippetAround(text, p.re), hidden: false });
      }
      continue;
    }
    hiddenTextFound++;
    if (matched.length) {
      hiddenHit = true;
      score += 0.5 + 0.1 * matched.length;
      hits.push({
        technique: `${chunk.technique} (${matched.map((p) => p.id).join(", ")})`,
        snippet: snippetAround(text, matched[0]!.re),
        hidden: true,
      });
    }
  }

  score = Math.min(1, Math.round(score * 100) / 100);
  return { detected: hiddenHit || score >= 0.5, score, hits, hiddenTextFound };
}

/** Plain text of a page with hidden parts removed, for short excerpts in the audit log. */
export function visibleExcerpt(content: string, max = 1500): string {
  const v = collectChunks(content).find((c) => c.technique === "visible")?.text ?? "";
  return clean(v).slice(0, max);
}
