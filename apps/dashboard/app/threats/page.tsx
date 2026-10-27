"use client";

import type { PaymentRequestDTO } from "@agentguard/shared";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { DecisionPill, ToolBadge } from "@/components/Pills";
import { api, money, timeAgo } from "@/lib/api";
import { techniqueLabel } from "@/lib/techniques";
import { useLiveEvents } from "@/lib/useLiveEvents";

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
    <div>
      <PageHeader title="Threats" aside={items && items.length > 0 ? <span className="text-[14px] text-ink-2">{items.length} caught so far</span> : null}>
        Web pages sometimes carry instructions written for the agent rather than for you, often hidden from view. These are the attempts AgentGuard caught,
        with the hidden text pulled out so you can read it.
      </PageHeader>

      {items && items.length === 0 && (
        <div className="sheet px-6 py-12 text-center">
          <p className="section-title">Nothing caught yet.</p>
          <p className="mx-auto mt-2 max-w-md text-ink-2">When a page tries to steer one of your agents, the attempt and the hidden text will show up here.</p>
        </div>
      )}

      <div className="space-y-5">
        {items?.map((t) => (
          <article key={t.id} className="sheet p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <DecisionPill decision={t.decision} />
              <h3 className="text-[16px] font-semibold">
                {t.quantity > 1 ? `${t.quantity} × ` : ""}
                {t.item}
              </h3>
              {t.kind === "paypal_tool" ? (
                t.toolName && <ToolBadge name={t.toolName} />
              ) : (
                <span className="text-[13.5px] text-ink-2">
                  at {t.merchantName ?? t.merchantDomain} · <span className="figure font-mono text-[13px]">{money(t.amount, t.currency)}</span>
                </span>
              )}
              <time className="ml-auto text-[12.5px] text-ink-3" dateTime={t.createdAt} title={new Date(t.createdAt).toLocaleString()}>
                {timeAgo(t.createdAt)}
              </time>
            </div>
            <p className="mt-3 max-w-[75ch] text-[14.5px] leading-relaxed">{t.explanation}</p>
            {t.taskDescription && (
              <p className="mt-2 text-[13px] text-ink-3">
                What the person actually asked for: <span className="font-serif text-[15px] italic text-ink-2">“{t.taskDescription}”</span>
              </p>
            )}

            {t.injectionEvidence.length > 0 && (
              <>
                <h4 className="mt-5 mb-2 text-[13px] font-semibold text-ink-2">What was on the page ({t.injectionEvidence.length})</h4>
                <div className="grid gap-3 md:grid-cols-2">
                  {t.injectionEvidence.map((e, i) => {
                    const l = techniqueLabel(e.technique);
                    return (
                      <div key={i} className="rounded-[5px] border border-rule bg-paper/50 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold">{l.title}</span>
                          {e.hidden && <span className="stamp text-bad !text-[9.5px]">Hidden</span>}
                        </div>
                        {l.patterns && <div className="mt-0.5 font-mono text-[11px] text-ink-3">{l.patterns}</div>}
                        <p className="mt-2 font-mono text-[12px] leading-[1.75] break-words whitespace-pre-wrap">
                          <mark className="box-decoration-clone bg-bad-wash px-0.5 text-[#7a2618]">{e.snippet}</mark>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
