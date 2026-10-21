"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
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
    <details className="group mt-4 rounded-[5px] border border-rule">
      <summary className="cursor-pointer px-3 py-2 text-[13px] text-ink-2 select-none hover:text-ink">
        <span className="group-open:hidden">Show</span>
        <span className="hidden group-open:inline">Hide</span> the compiled JSON
      </summary>
      <pre className="max-h-96 overflow-auto border-t border-rule bg-paper/60 px-3 py-3 font-mono text-[12px] leading-relaxed text-ink-2">
        {JSON.stringify(value, null, 2)}
      </pre>
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
    <div>
      <PageHeader title="Spending rules">
        Write them the way you&apos;d tell a person. AgentGuard turns them into a strict policy, shows you exactly what it understood, and enforces it only after
        you confirm.
      </PageHeader>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-6">
          <div className="sheet p-5">
            <label htmlFor="rules" className="text-[14px] font-semibold">
              Your rules
            </label>
            <textarea
              id="rules"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              placeholder="Max $150 a week on groceries. Never buy gift cards. Ask me before anything over $50."
              className="lined mt-2 w-full resize-y rounded-[5px] border border-rule-2 text-[15px] outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-wash)]"
            />
            <div className="mt-4">
              <p className="text-[13px] text-ink-3">Some rules people start with. Click one to add it:</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => addExample(ex)}
                    className="text-left text-[13.5px] text-ink-2 underline decoration-rule-2 decoration-dotted underline-offset-4 hover:text-ink hover:decoration-ink"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-rule pt-4">
              <button className="btn btn-primary" disabled={busy !== null || text.trim().length < 3} onClick={compile}>
                {busy === "compile" ? "Reading your rules…" : "Preview policy"}
              </button>
              {saved && <span className="text-[14px] text-ok">Saved. This policy is now in force.</span>}
            </div>
            {error && <p className="mt-3 text-[14px] text-bad">{error}</p>}
          </div>

          {result && (
            <div id="compile-result" className="sheet just-in scroll-mt-36 border-t-[3px] !border-t-accent p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="section-title">Here&apos;s what I understood</h2>
                <span className="font-serif text-[14px] italic text-ink-3">{result.engine === "llm" ? "read by Claude" : "read by the rule parser"}</span>
              </div>
              <ol className="mt-4 divide-y divide-rule border-y border-rule">
                {result.summary.map((s, i) => (
                  <li key={s} className="flex gap-4 py-2.5 text-[14.5px]">
                    <span className="figure w-5 shrink-0 pt-0.5 font-mono text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                    {s}
                  </li>
                ))}
              </ol>
              {result.clarifications.length > 0 && (
                <div className="mt-4 rounded-[5px] bg-warn-wash px-4 py-3 text-[14px] text-warn">
                  <p className="font-semibold">I wasn&apos;t sure about these, so they won&apos;t be enforced:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {result.clarifications.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.warning && <p className="mt-3 text-[13px] text-warn">{result.warning}</p>}
              <p className="mt-4 text-[13px] text-ink-3">
                This summary is generated from the policy JSON itself, so it always matches what gets enforced. The policy is checked by plain code, not AI.
              </p>
              <JsonBlock value={result.compiled} />
              <PolicySimulator key={result.id} policyId={result.id} />
              <div className="mt-5 flex flex-wrap gap-2">
                <button className="btn btn-approve" disabled={busy !== null} onClick={activate}>
                  {busy === "activate" ? "Turning it on…" : "Confirm and turn on"}
                </button>
                <button className="btn btn-quiet" onClick={() => setResult(null)}>
                  Keep editing
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-6">
          <div className="sheet p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="section-title">Policy in force</h2>
              {active && <span className="stamp text-ok">Active</span>}
            </div>
            {!active ? (
              <p className="mt-3 text-[14px] text-warn">No policy yet, so every agent payment will ask for your approval.</p>
            ) : (
              <>
                <ul className="mt-4 space-y-2 text-[14.5px]">
                  {active.summary.map((s) => (
                    <li key={s} className="flex gap-2.5">
                      <span className="text-ok" aria-hidden>
                        ✓
                      </span>
                      {s}
                    </li>
                  ))}
                </ul>
                <blockquote className="mt-4 border-l-2 border-rule-2 pl-3 font-serif text-[15px] italic text-ink-2">“{active.rawText}”</blockquote>
                <JsonBlock value={active.compiled} />
              </>
            )}
          </div>

          {history.length > 0 && (
            <div className="sheet p-5">
              <h2 className="text-[14px] font-semibold">Every version</h2>
              <ul className="mt-2 max-h-80 divide-y divide-rule overflow-y-auto pr-1 text-[13.5px]">
                {history.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.active ? "bg-ok" : "bg-rule-2"}`} title={p.active ? "In force" : undefined} />
                    <span className="min-w-0 flex-1 truncate" title={p.rawText}>
                      {p.rawText}
                    </span>
                    <time className="figure shrink-0 text-[12px] text-ink-3" dateTime={p.createdAt}>
                      {new Date(p.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
