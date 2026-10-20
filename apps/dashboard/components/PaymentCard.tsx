"use client";

import type { PaymentRequestDTO } from "@agentguard/shared";
import { useState } from "react";
import { api, money, timeAgo } from "@/lib/api";
import { DecisionPill, StatusPill, ToolBadge, decisionColor } from "./Pills";
import { RiskGauge } from "./RiskGauge";

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

  return (
    <article
      className={`card relative overflow-hidden p-4 ${fresh ? "flash-in" : ""}`}
      style={{ borderLeft: `4px solid ${decisionColor(p.decision)}` }}
    >
      <div className="flex items-start gap-4">
        <RiskGauge score={p.riskScore} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <DecisionPill decision={p.decision} />
            <StatusPill status={p.status} kind={p.kind} />
            {p.kind === "paypal_tool" && p.toolName && <ToolBadge name={p.toolName} />}
            {p.injectionDetected && (
              <span className="rounded-full border border-bad/40 bg-bad/10 px-2 py-0.5 text-xs font-semibold text-bad">⚠ prompt injection</span>
            )}
            <span className="ml-auto text-xs text-muted">{timeAgo(p.createdAt)}</span>
          </div>
          <h3 className="mt-2 truncate text-base font-semibold">
            {p.quantity > 1 ? `${p.quantity} × ` : ""}
            {p.item}
          </h3>
          <p className="text-sm text-muted">
            {p.kind === "paypal_tool" ? (
              <>Ops agent action on your PayPal account{p.category ? ` · ${p.category.replace("_", " ")}` : ""}</>
            ) : (
              <>
                {p.merchantName ?? p.merchantDomain} · <span className="font-mono">{p.merchantDomain}</span>
                {p.category ? ` · ${p.category.replace("_", " ")}` : ""}
              </>
            )}
          </p>
          <p className="mt-2 text-sm">{p.explanation}</p>
          {p.taskDescription && <p className="mt-1 text-xs text-muted">Task: “{p.taskDescription}”</p>}
          {hidden && (
            <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-bad/30 bg-bad/5 p-2 font-mono text-xs text-red-300">
              {hidden.snippet}
            </pre>
          )}
          {p.failureReason && <p className="mt-2 text-xs text-bad">{p.failureReason}</p>}
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">{p.kind === "paypal_tool" && p.amount === 0 ? "–" : money(p.amount, p.currency)}</div>
          {p.paypalCaptureId && <div className="mt-1 font-mono text-[10px] text-muted">cap {p.paypalCaptureId.slice(-10)}</div>}
        </div>
      </div>

      {(p.status === "HELD" || (p.status === "PENDING" && p.decision !== "BLOCK" && p.kind !== "paypal_tool")) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="mr-auto text-xs text-warn">
            {p.kind === "paypal_tool"
              ? "AgentGuard runs this PayPal action only if you approve."
              : p.status === "HELD"
                ? "PayPal is holding the funds until you decide."
                : "Waiting for approval on PayPal."}
          </span>
          {p.status === "HELD" ? (
            <button className="btn btn-ok" disabled={!!busy} onClick={() => act("approve")}>
              {busy === "approve" ? (p.kind === "paypal_tool" ? "Running…" : "Capturing…") : "✓ Approve"}
            </button>
          ) : (
            p.approveUrl && (
              <a className="btn btn-ok" href={p.approveUrl} target="_blank" rel="noreferrer">
                Approve on PayPal ↗
              </a>
            )
          )}
          <button className="btn btn-bad" disabled={!!busy} onClick={() => act("reject")}>
            {busy === "reject" ? "Voiding…" : "✕ Reject"}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
    </article>
  );
}
