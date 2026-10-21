"use client";

import type { DemoRunStatus, PaymentRequestDTO } from "@agentguard/shared";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
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

// The agent's log marks each line with an emoji; the console colours by it.
function lineColor(line: string): string {
  if (line.startsWith("⛔")) return "text-[#f2a08c]";
  if (line.startsWith("✅")) return "text-[#a9d39b]";
  if (line.startsWith("📱")) return "text-[#efc677]";
  if (line.startsWith("💳")) return "text-[#e6d391]";
  if (line.startsWith("🔧")) return "text-[#cfb0e3]";
  if (line.startsWith("🤖")) return "text-[#9fc6d9]";
  if (/^[─-]+$/.test(line)) return "text-[#6f6a5f]";
  return "text-[#ddd7c9]";
}

const STATUS_DOT: Record<string, string> = { running: "bg-[#efc677] animate-pulse", finished: "bg-[#a9d39b]", failed: "bg-[#f2a08c]" };

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
      setNotice("Demo reset. The sample policy is back, payments are cleared and the kill switch is off.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const running = run?.status === "running";
  const active = scenarios.find((s) => s.id === run?.scenario);

  return (
    <div>
      <PageHeader
        title="Try it"
        aside={
          <button className="btn btn-quiet" disabled={busy !== null || running} onClick={reset}>
            {busy === "reset" ? "Resetting…" : "Reset demo"}
          </button>
        }
      >
        Each scenario runs a real agent on the server, against the live AgentGuard API and the demo stores. Its log streams on the right, and its payments
        also land on the{" "}
        <Link href="/" className="link">
          Live
        </Link>{" "}
        and{" "}
        <Link href="/audit" className="link">
          Audit log
        </Link>{" "}
        pages. No terminal needed.
      </PageHeader>

      {notice && <div className="sheet mb-6 border-l-[3px] !border-l-accent px-4 py-3 text-[14px]">{notice}</div>}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <ol className="min-w-0 space-y-3">
          {scenarios.map((s, i) => {
            const current = run?.scenario === s.id;
            const unguarded = s.id === "unguarded";
            return (
              <li key={s.id} className={`sheet p-5 ${current ? "!border-ink" : ""}`}>
                <div className="flex items-baseline gap-3">
                  <span className="figure font-mono text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  <h2 className="font-serif text-[20px] leading-tight font-medium">{s.title}</h2>
                </div>
                <div className="mt-2 pl-[30px]">
                  <p className="text-[14.5px] text-ink-2">{s.story}</p>
                  <p className="mt-3 text-[14px]">
                    <span className="font-semibold">What should happen: </span>
                    {s.expect}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <button className={`btn btn-sm ${unguarded ? "btn-reject" : "btn-primary"}`} disabled={busy !== null || running} onClick={() => start(s.id)}>
                      {busy === s.id ? "Starting…" : running && current ? "Running…" : unguarded ? "Run without AgentGuard" : "Run"}
                    </button>
                    {unguarded && storesUrl && (
                      <a className="link text-[13px]" href={`${storesUrl}/orders`} target="_blank" rel="noreferrer">
                        See what got charged ↗
                      </a>
                    )}
                    {s.id === "ops" && storesUrl && (
                      <a className="link text-[13px]" href={`${storesUrl}/freshcart/support`} target="_blank" rel="noreferrer">
                        Open the support inbox ↗
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <section className="min-w-0 space-y-8">
          <div className="overflow-hidden rounded-md border border-night bg-night shadow-[0_8px_24px_-12px_rgba(30,25,15,0.45)]">
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5 text-[13px] text-[#ddd7c9]">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[run?.status ?? ""] ?? "bg-[#5d594f]"}`} />
              <span className="font-medium">{active ? active.title : "Agent console"}</span>
              <span className="text-[#8f897b]">{run ? run.status : "idle"}</span>
              {running && (
                <button className="ml-auto rounded-[4px] border border-white/20 px-2.5 py-1 text-[12px] hover:bg-white/10" onClick={stop}>
                  Stop
                </button>
              )}
            </div>
            <div ref={consoleRef} className="h-[420px] overflow-auto p-4 font-mono text-[12.5px] leading-[1.7]">
              {lines.length === 0 ? (
                <p className="text-[#8f897b]">Pick a scenario and press Run. The agent&apos;s log will stream here.</p>
              ) : (
                lines.map((l, i) => (
                  <div key={i} className={`break-words whitespace-pre-wrap ${lineColor(l)}`}>
                    {l}
                  </div>
                ))
              )}
            </div>
          </div>

          {payments.length > 0 && (
            <div>
              <h2 className="section-title mb-4">What AgentGuard decided</h2>
              <div className="space-y-3">
                {payments.map((p) => (
                  <PaymentCard key={p.id} p={p} fresh />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
