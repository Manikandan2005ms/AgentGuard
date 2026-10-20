"use client";

import type { PaymentRequestDTO } from "@agentguard/shared";
import { useEffect, useState } from "react";
import { DecisionPill } from "@/components/Pills";
import { api, money, timeAgo } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";

const TECHNIQUE_LABELS: Record<string, string> = {
  css_display_none: "Hidden with display:none",
  css_visibility_hidden: "Hidden with visibility:hidden",
  css_opacity_0: "Fully transparent text",
  css_tiny_font: "Microscopic font size",
  css_offscreen: "Positioned off-screen",
  css_clipped: "Clipped out of view",
  css_zero_height: "Zero-height container",
  css_transparent_text: "Transparent text colour",
  css_same_color_as_background: "Text same colour as background",
  css_white_text: "White-on-white text",
  html_comment: "HTML comment",
  attribute_alt: "Image alt text",
  attribute_title: "Title attribute",
  "attribute_aria-label": "aria-label attribute",
  attribute_content: "Meta content",
  aria_hidden: "aria-hidden element",
  html_hidden_attribute: "hidden attribute",
  structured_data: "JSON-LD structured data",
  unicode_tag_smuggling: "Invisible Unicode tag characters",
  zero_width_characters: "Zero-width characters",
  noscript_content: "<noscript> block",
  template_content: "<template> block",
  llm_classifier: "Flagged by the AI classifier",
};

function label(technique: string) {
  const key = technique.split(" (")[0]!;
  const patterns = /\(([^)]+)\)/.exec(technique)?.[1];
  return { title: TECHNIQUE_LABELS[key] ?? key.replace(/^visible_/, "Visible text: ").replace(/_/g, " "), patterns };
}

export default function ThreatsPage() {
  const [items, setItems] = useState<PaymentRequestDTO[] | null>(null);
  const load = () => api<PaymentRequestDTO[]>("/api/threats").then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);
  useLiveEvents((e) => {
    if ((e.type === "payment.created" || e.type === "payment.updated") && e.payment.injectionDetected) load();
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Threats</h1>
        <p className="text-sm text-muted">Prompt-injection attempts found on pages your agents read, with the hidden text highlighted.</p>
      </div>
      {items && items.length === 0 && <div className="card p-6 text-sm text-muted">No injection attempts detected yet. 🛡️</div>}
      <div className="space-y-4">
        {items?.map((t) => (
          <article key={t.id} className="card p-4" style={{ borderLeft: "4px solid #ef4444" }}>
            <div className="flex flex-wrap items-center gap-2">
              <DecisionPill decision={t.decision} />
              <h3 className="font-semibold">
                {t.quantity > 1 ? `${t.quantity} × ` : ""}
                {t.item}
              </h3>
              <span className="text-sm text-muted">
                at {t.merchantName ?? t.merchantDomain} · {money(t.amount, t.currency)}
              </span>
              <span className="ml-auto text-xs text-muted">{timeAgo(t.createdAt)}</span>
            </div>
            <p className="mt-2 text-sm">{t.explanation}</p>
            {t.taskDescription && <p className="mt-1 text-xs text-muted">The user had asked: “{t.taskDescription}”</p>}
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {t.injectionEvidence.map((e, i) => {
                const l = label(e.technique);
                return (
                  <div key={i} className="rounded-lg border border-bad/30 bg-bad/5 p-3">
                    <div className="flex items-center gap-2 text-xs">
                      {e.hidden && <span className="rounded bg-bad px-1.5 py-0.5 font-bold text-white">HIDDEN</span>}
                      <span className="font-semibold text-red-300">{l.title}</span>
                    </div>
                    {l.patterns && <div className="mt-1 font-mono text-[10px] text-muted">{l.patterns}</div>}
                    <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-red-200">
                      <mark className="bg-bad/25 text-red-100">{e.snippet}</mark>
                    </pre>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
