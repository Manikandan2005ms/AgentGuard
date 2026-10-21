"use client";

import type { PaymentRequestDTO } from "@agentguard/shared";
import { useState } from "react";
import { api, money, timeAgo } from "@/lib/api";
import { riskColor } from "@/lib/palette";
import { DecisionPill, InjectionTag, StatusPill, ToolBadge } from "./Pills";
import { RiskGauge } from "./RiskGauge";

/** Held funds, or a toolkit action waiting for the user, can be decided right from the card. */
export const needsYou = (p: PaymentRequestDTO) =>
  p.status === "HELD" || (p.status === "PENDING" && p.decision !== "BLOCK" && p.kind !== "paypal_tool");

export function PaymentCard({ p, fresh }: { p: PaymentRequestDTO; fresh?: boolean }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "approve" | "reject") => {
    setBusy(action);
    setError(null);
    try {
      await api(`/api/payments/${p.id}/${action}`, { method: "POST" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Show the hidden snippet that matched the most injection patterns.
  const patternCount = (t: string) => (/\(([^)]+)\)/.exec(t)?.[1]?.split(",").length ?? 0);
  const hidden = p.injectionEvidence.filter((e) => e.hidden).sort((a, b) => patternCount(b.technique) - patternCount(a.technique))[0];
  const tool = p.kind === "paypal_tool";
  const amount = tool && p.amount === 0 ? "–" : money(p.amount, p.currency);
  const category = p.category ? p.category.replace("_", " ") : null;
  const risk = Math.round(p.riskScore);

  return (
    <article className={`sheet overflow-hidden ${fresh ? "just-in" : ""}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 p-4 sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:p-5">
        <div className="hidden sm:block">
          <RiskGauge score={p.riskScore} />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <DecisionPill decision={p.decision} />
            <StatusPill status={p.status} kind={p.kind} />
            {tool && p.toolName && <ToolBadge name={p.toolName} />}
            {p.injectionDetected && <InjectionTag />}
          </div>
          <h3 className="mt-2 text-[16px] leading-snug font-semibold break-words">
            {p.quantity > 1 ? `${p.quantity} × ` : ""}
            {p.item}
          </h3>
          <p className="mt-0.5 text-[13.5px] text-ink-2">
            {tool ? (
              <>The ops agent, on your PayPal account{category ? ` · ${category}` : ""}</>
            ) : (
              <>
                {p.merchantName ?? p.merchantDomain}
                {p.merchantName && <span className="font-mono text-[12px] text-ink-3"> {p.merchantDomain}</span>}
                {category ? ` · ${category}` : ""}
              </>
            )}
          </p>
          <p className="mt-3 max-w-[70ch] text-[14.5px] leading-relaxed">{p.explanation}</p>
          {p.taskDescription && (
            <p className="mt-2 text-[13px] text-ink-3">
              The agent was asked: <span className="font-serif text-[15px] italic text-ink-2">“{p.taskDescription}”</span>
            </p>
          )}
          {hidden && (
            <figure className="mt-3 border-l-2 border-bad bg-bad-wash/60 px-3 py-2">
              <figcaption className="text-[12px] font-semibold text-bad">Hidden in the page the agent read</figcaption>
              <pre className="mt-1 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-[#7a2618]">{hidden.snippet}</pre>
            </figure>
          )}
          {p.failureReason && <p className="mt-2 text-[13px] text-bad">{p.failureReason}</p>}
        </div>

        <div className="text-right">
          <div className="figure font-mono text-[17px] font-medium">{amount}</div>
          <time className="mt-1 block text-[12.5px] text-ink-3" dateTime={p.createdAt} title={new Date(p.createdAt).toLocaleString()}>
            {timeAgo(p.createdAt)}
          </time>
          <div className="figure mt-1 text-[12.5px] font-semibold sm:hidden" style={{ color: riskColor(risk) }}>
            Risk {risk}
          </div>
          {p.paypalCaptureId && (
            <div className="mt-1 hidden font-mono text-[10.5px] text-ink-3 sm:block" title={`PayPal capture ${p.paypalCaptureId}`}>
              cap …{p.paypalCaptureId.slice(-8)}
            </div>
          )}
        </div>
      </div>

      {needsYou(p) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-rule bg-warn-wash/50 px-4 py-3 sm:pr-5 sm:pl-[104px]">
          <p className="mr-auto text-[13.5px] text-warn">
            {tool
              ? "AgentGuard will run this PayPal action only if you approve it."
              : p.status === "HELD"
                ? "PayPal is holding the money. Nothing is charged until you decide."
                : "Waiting for you to approve it on PayPal."}
          </p>
          {p.status === "HELD" ? (
            <button className="btn btn-sm btn-approve" disabled={!!busy} onClick={() => act("approve")}>
              {busy === "approve" ? (tool ? "Running…" : "Capturing…") : "Approve"}
            </button>
          ) : (
            p.approveUrl && (
              <a className="btn btn-sm btn-approve" href={p.approveUrl} target="_blank" rel="noreferrer">
                Approve on PayPal ↗
              </a>
            )
          )}
          <button className="btn btn-sm btn-reject" disabled={!!busy} onClick={() => act("reject")}>
            {busy === "reject" ? "Voiding…" : "Reject"}
          </button>
        </div>
      )}
      {error && <p className="border-t border-rule px-5 py-2 text-[13px] text-bad">{error}</p>}
    </article>
  );
}
