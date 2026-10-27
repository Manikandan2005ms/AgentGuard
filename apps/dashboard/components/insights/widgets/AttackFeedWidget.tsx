"use client";

import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import type { MouseEvent } from "react";
import { timeAgo } from "@/lib/api";
import type { AttackFeedDef } from "../widgets";
import { useWidgetQuery } from "./useWidgetQuery";

interface Attack {
  key: string;
  snippet: string;
  at: unknown;
  when: string;
  source: unknown;
  sourceLabel: string | null;
  technique: string | null;
  outcome: string | null;
}

const OUTCOME_CLASS: Record<string, string> = { Blocked: "text-bad", "Asked you": "text-warn", Approved: "text-ok" };

/** Newest-first prompt-injection attempts, each with the hidden text pulled off the store's page. */
export function AttackFeedWidget(params: AgWidgetParams<AttackFeedDef>) {
  const { dataMapping, widgetApi, format } = params;
  const snippet = dataMapping.snippet?.at(0);
  const time = dataMapping.time?.at(0);
  const source = dataMapping.source?.at(0);
  const technique = dataMapping.technique?.at(0);
  const outcome = dataMapping.outcome?.at(0);
  const limit = Math.max(1, Math.min(200, format?.style?.limit ?? 25));

  const fields = [snippet, time, source, technique, outcome].filter((f): f is AgWidgetField => !!f);
  const attacks = useWidgetQuery<Attack[]>(
    widgetApi,
    snippet && time ? { fields, sort: [{ field: time, direction: "desc" }], limit: { count: limit } } : null,
    (rows) => {
      if (!snippet || !time || rows.length === 0) return null;
      return rows.map((r, i) => {
        const at = r[time.key];
        const iso = at instanceof Date ? at.toISOString() : typeof at === "string" || typeof at === "number" ? new Date(at).toISOString() : null;
        return {
          key: `${i}:${String(at)}`,
          snippet: String(r[snippet.key] ?? ""),
          at,
          when: iso ? timeAgo(iso) : widgetApi.formatFieldValue(time, at),
          source: source ? r[source.key] : null,
          sourceLabel: source ? widgetApi.formatFieldValue(source, r[source.key]) : null,
          technique: technique ? widgetApi.formatFieldValue(technique, r[technique.key]) : null,
          outcome: outcome ? widgetApi.formatFieldValue(outcome, r[outcome.key]) : null,
        };
      });
    },
    params,
  );
  if (!attacks) return <div className="h-full w-full" />;

  const selected = new Set<unknown>();
  for (const s of widgetApi.getCrossFilterSelections() ?? []) if (s.type === "value") s.values.forEach((v) => selected.add(v));

  // Clicking an attack filters the rest of the page to its store; ctrl/cmd-click adds stores.
  const pick = (e: MouseEvent, a: Attack) => {
    e.stopPropagation();
    if (!source || a.source == null) return;
    widgetApi.toggleCrossFilter({ type: "value", value: a.source, field: source, group: 0, reset: !(e.metaKey || e.ctrlKey) });
  };

  return (
    <ol className="h-full space-y-2.5 overflow-y-auto pr-1" onClick={() => widgetApi.resetCrossFilter()}>
      {attacks.map((a) => {
        const active = selected.size > 0 && selected.has(a.source);
        return (
          <li key={a.key}>
            <button
              type="button"
              onClick={(e) => pick(e, a)}
              aria-pressed={active}
              title={source ? "Filter the page to this store" : undefined}
              className={`block w-full rounded-[5px] border p-2.5 text-left transition-colors ${
                active ? "border-accent bg-accent-wash" : selected.size > 0 ? "border-rule bg-paper/40 opacity-60" : "border-rule bg-paper/40 hover:border-rule-2"
              }`}
            >
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
                {a.outcome && <span className={`font-semibold ${OUTCOME_CLASS[a.outcome] ?? "text-ink-2"}`}>{a.outcome}</span>}
                {a.sourceLabel && <span className="font-medium text-ink">{a.sourceLabel}</span>}
                {a.technique && <span className="text-ink-3">· {a.technique}</span>}
                <span className="ml-auto text-ink-3">{a.when}</span>
              </span>
              <span className="mt-1.5 block font-mono text-[11.5px] leading-[1.7] break-words whitespace-pre-wrap">
                <mark className="box-decoration-clone bg-bad-wash px-0.5 text-[#7a2618]">{a.snippet}</mark>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
