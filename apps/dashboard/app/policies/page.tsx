"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const PolicySimulator = dynamic(() => import("@/components/PolicySimulator"), { ssr: false });

interface PolicyView {
  id: string;
  rawText: string;
  compiled: unknown;
  summary: string[];
  clarifications: string[];
  engine: string;
  active: boolean;
  createdAt: string;
}

interface CompileResult {
  id: string;
  compiled: unknown;
  summary: string[];
  clarifications: string[];
  engine: "llm" | "rules";
  warning: string | null;
}

const EXAMPLES = [
  "Never buy gift cards.",
  "Ask me before anything over $50.",
  "Max $150 a week on groceries.",
  "Never spend more than $200 on a single purchase.",
  "Don't pay merchants younger than 30 days.",
  "Electronics only from stores I've used before.",
  "No more than 5 purchases per hour.",
  "Ask me for anything between 11pm and 7am.",
  "Spend at most $600 per month.",
];

function JsonBlock({ value }: { value: unknown }) {
  return (
    <details className="mt-3 rounded-lg border border-line bg-ink/60">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-muted">Compiled policy JSON</summary>
      <pre className="max-h-96 overflow-auto px-3 pb-3 font-mono text-xs text-cyan-200">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export default function PoliciesPage() {
  const [active, setActive] = useState<PolicyView | null>(null);
  const [history, setHistory] = useState<PolicyView[]>([]);
  const [text, setText] = useState("");
  const [result, setResult] = useState<CompileResult | null>(null);
  const [busy, setBusy] = useState<"compile" | "activate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    const [a, h] = await Promise.all([api<{ policy: PolicyView | null }>("/api/policies/active"), api<PolicyView[]>("/api/policies")]);
    setActive(a.policy);
    setHistory(h);
    return a.policy;
  };

  useEffect(() => {
    load()
      .then((p) => setText((t) => t || p?.rawText || ""))
      .catch((e) => setError(e.message));
  }, []);

  const compile = async () => {
    setBusy("compile");
    setError(null);
    setSaved(false);
    try {
      setResult(await api<CompileResult>("/api/policies/compile", { json: { rawText: text } }));
      setTimeout(() => document.getElementById("compile-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const activate = async () => {
    if (!result) return;
    setBusy("activate");
    try {
      await api(`/api/policies/${result.id}/activate`, { method: "POST" });
      setResult(null);
      setSaved(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const addExample = (ex: string) => setText((t) => (t.trim() ? `${t.trim().replace(/[.]?$/, ".")} ${ex}` : ex));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="min-w-0 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Spending rules</h1>
          <p className="text-sm text-muted">Write them in plain English. AI compiles them into a strict policy you confirm before it takes effect.</p>
        </div>
        <div className="card p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder="Max $150 a week on groceries. Never buy gift cards. Ask me before anything over $50."
            className="w-full resize-y rounded-lg border border-line bg-ink/70 p-3 text-sm outline-none focus:border-shield"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => addExample(ex)} className="rounded-full border border-line bg-panel-2 px-3 py-1 text-xs text-muted hover:text-text">
                + {ex}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button className="btn btn-primary" disabled={busy !== null || text.trim().length < 3} onClick={compile}>
              {busy === "compile" ? "Compiling…" : "Compile rules"}
            </button>
            {saved && <span className="text-sm text-ok">✓ Policy confirmed and active</span>}
          </div>
          {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        </div>

        {result && (
          <div id="compile-result" className="card flash-in scroll-mt-20 border-shield/40 p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Here&apos;s what I understood</h2>
              <span className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted">
                {result.engine === "llm" ? "compiled by Claude" : "compiled by rule parser"}
              </span>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {result.summary.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="text-shield">▸</span>
                  {s}
                </li>
              ))}
            </ul>
            {result.clarifications.length > 0 && (
              <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
                <div className="font-semibold">Needs clarification (not enforced):</div>
                <ul className="mt-1 list-disc pl-5">
                  {result.clarifications.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.warning && <p className="mt-3 text-xs text-warn">{result.warning}</p>}
            <p className="mt-3 text-xs text-muted">
              The summary above is generated from the JSON itself, so it always matches what will be enforced. The policy is checked by plain code, not AI.
            </p>
            <JsonBlock value={result.compiled} />
            <PolicySimulator key={result.id} policyId={result.id} />
            <div className="mt-4 flex gap-2">
              <button className="btn btn-ok" disabled={busy !== null} onClick={activate}>
                {busy === "activate" ? "Activating…" : "✓ Confirm & activate"}
              </button>
              <button className="btn btn-ghost" onClick={() => setResult(null)}>
                Edit rules
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="min-w-0 space-y-4">
        <div className="card p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Active policy</h2>
            {active && <span className="rounded-md border border-ok/40 px-2 py-0.5 text-[11px] text-ok">enforced</span>}
          </div>
          {!active ? (
            <p className="mt-2 text-sm text-warn">No active policy: every agent payment will ask for your approval.</p>
          ) : (
            <>
              <ul className="mt-3 space-y-1.5 text-sm">
                {active.summary.map((s) => (
                  <li key={s} className="flex gap-2">
                    <span className="text-ok">✓</span>
                    {s}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs italic text-muted">“{active.rawText}”</p>
              <JsonBlock value={active.compiled} />
            </>
          )}
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-muted">History</h2>
          <ul className="mt-2 max-h-80 divide-y divide-line overflow-y-auto pr-1 text-sm">
            {history.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <span className={`h-2 w-2 rounded-full ${p.active ? "bg-ok" : "bg-line"}`} />
                <span className="min-w-0 flex-1 truncate" title={p.rawText}>
                  {p.rawText}
                </span>
                <span className="text-xs text-muted">{new Date(p.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
