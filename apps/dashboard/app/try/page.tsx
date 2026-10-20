"use client";

import type { DemoRunStatus, PaymentRequestDTO } from "@agentguard/shared";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PaymentCard } from "@/components/PaymentCard";
import { api } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";

interface Scenario {
  id: string;
  title: string;
  story: string;
  expect: string;
}

interface Run {
  id: string;
  scenario: string;
  status: DemoRunStatus;
  lines: string[];
  startedAt: string;
  finishedAt: string | null;
}

const ICON: Record<string, string> = { attack: "🕵️", approval: "📱", ops: "🧰", unguarded: "💸" };

function lineColor(line: string): string {
  if (line.startsWith("⛔")) return "text-red-400";
  if (line.startsWith("✅")) return "text-green-400";
  if (line.startsWith("📱")) return "text-amber-300";
  if (line.startsWith("💳")) return "text-yellow-300";
  if (line.startsWith("🔧")) return "text-fuchsia-300";
  if (line.startsWith("🤖")) return "text-cyan-300";
  if (/^[─-]+$/.test(line)) return "text-muted";
  return "text-slate-300";
}

export default function TryPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [storesUrl, setStoresUrl] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [payments, setPayments] = useState<PaymentRequestDTO[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;

  const loadPaymentsSince = useCallback(async (since: string) => {
    const rows = await api<PaymentRequestDTO[]>("/api/audit?limit=60");
    setPayments(rows.filter((p) => p.createdAt >= since));
  }, []);

  useEffect(() => {
    api<{ scenarios: Scenario[]; storesUrl: string }>("/api/demo/scenarios")
      .then((r) => {
        setScenarios(r.scenarios);
        setStoresUrl(r.storesUrl);
      })
      .catch((e) => setNotice(e.message));
    api<{ run: Run | null }>("/api/demo/runs/latest")
      .then((r) => {
        if (!r.run) return;
        setRun(r.run);
        setLines(r.run.lines);
        void loadPaymentsSince(r.run.startedAt);
      })
      .catch(() => undefined);
  }, [loadPaymentsSince]);

  useLiveEvents((e) => {
    const current = runRef.current;
    if (e.type === "demo.status") {
      if (!current || current.id !== e.runId) {
        // Someone (maybe another viewer) started a new run: follow it.
        setRun({ id: e.runId, scenario: e.scenario, status: e.status, lines: [], startedAt: new Date().toISOString(), finishedAt: null });
        setLines([]);
        setPayments([]);
      } else {
        setRun({ ...current, status: e.status });
      }
    } else if (e.type === "demo.log") {
      if (current && e.runId === current.id) setLines((l) => [...l, e.line]);
    } else if (e.type === "payment.created") {
      if (current?.status === "running") setPayments((p) => [e.payment, ...p]);
    } else if (e.type === "payment.updated") {
      setPayments((p) => p.map((x) => (x.id === e.payment.id ? e.payment : x)));
    } else if (e.type === "demo.reset") {
      setRun(null);
      setLines([]);
      setPayments([]);
    }
  });

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [lines]);

  const start = async (id: string) => {
    setBusy(id);
    setNotice(null);
    try {
      const r = await api<{ run: Run }>("/api/demo/run", { json: { scenario: id } });
      setRun(r.run);
      setLines(r.run.lines);
      setPayments([]);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    await api("/api/demo/stop", { method: "POST" }).catch(() => undefined);
  };

  const reset = async () => {
    if (!window.confirm("Reset the demo? This clears every payment and restores the sample policy for everyone using this demo.")) return;
    setBusy("reset");
    try {
      await api("/api/demo/reset", { method: "POST" });
      setNotice("Demo reset: sample policy restored, payments cleared, kill switch off.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const running = run?.status === "running";
  const active = scenarios.find((s) => s.id === run?.scenario);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Try AgentGuard</h1>
          <p className="max-w-2xl text-sm text-muted">
            Each button runs a real agent on the server against the live AgentGuard API and the demo stores. Watch its log here and its payments land on the{" "}
            <Link href="/" className="text-shield underline">
              Live
            </Link>{" "}
            and{" "}
            <Link href="/audit" className="text-shield underline">
              Audit
            </Link>{" "}
            pages. No terminal needed.
          </p>
        </div>
        <button className="btn btn-ghost" disabled={busy !== null || running} onClick={reset}>
          {busy === "reset" ? "Resetting…" : "↺ Reset demo"}
        </button>
      </div>
      {notice && <div className="card border-shield/40 p-3 text-sm">{notice}</div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <section className="min-w-0 space-y-3">
          {scenarios.map((s) => (
            <article key={s.id} className={`card p-4 ${run?.scenario === s.id ? "border-shield/50" : ""}`}>
              <div className="flex items-start gap-3">
                <span className="text-2xl" aria-hidden>
                  {ICON[s.id] ?? "▶"}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{s.title}</h2>
                  <p className="mt-1 text-sm text-muted">{s.story}</p>
                  <p className="mt-2 text-sm">
                    <span className="text-muted">Expect: </span>
                    {s.expect}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 pl-10">
                <button className={`btn ${s.id === "unguarded" ? "btn-bad" : "btn-primary"}`} disabled={busy !== null || running} onClick={() => start(s.id)}>
                  {busy === s.id ? "Starting…" : running && run?.scenario === s.id ? "Running…" : "▶ Run"}
                </button>
                {s.id === "unguarded" && storesUrl && (
                  <a className="text-xs text-muted underline" href={`${storesUrl}/orders`} target="_blank" rel="noreferrer">
                    See what was charged ↗
                  </a>
                )}
                {s.id === "ops" && storesUrl && (
                  <a className="text-xs text-muted underline" href={`${storesUrl}/freshcart/support`} target="_blank" rel="noreferrer">
                    Open the inbox ↗
                  </a>
                )}
              </div>
            </article>
          ))}
        </section>

        <section className="min-w-0 space-y-3">
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-sm">
              <span
                className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-warn" : run?.status === "finished" ? "bg-ok" : run?.status === "failed" ? "bg-bad" : "bg-line"}`}
              />
              <span className="font-semibold">{active ? active.title : "Agent console"}</span>
              <span className="text-muted">{run ? run.status : "idle"}</span>
              {running && (
                <button className="btn btn-ghost ml-auto !px-2 !py-0.5 !text-xs" onClick={stop}>
                  Stop
                </button>
              )}
            </div>
            <div ref={consoleRef} className="h-[360px] overflow-auto bg-[#05080f] p-4 font-mono text-[12.5px] leading-relaxed">
              {lines.length === 0 ? (
                <p className="text-muted">Pick a scenario to run. The agent&apos;s log streams here.</p>
              ) : (
                lines.map((l, i) => (
                  <div key={i} className={`whitespace-pre-wrap break-words ${lineColor(l)}`}>
                    {l}
                  </div>
                ))
              )}
            </div>
          </div>

          {payments.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted">Decisions from this run</h2>
              {payments.map((p) => (
                <PaymentCard key={p.id} p={p} fresh />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
