"use client";

// Quiets AG's trial-licence banner in development (see the file for why).
import "@/lib/agGridLicense";
import { AgStudioAiModule, enableStudioDevValidations, type AgAiModel, type AgReportState, type AgStudioApi, type AgStudioMode } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";
import { insightsAi } from "./agents";
import { buildStudioData, type InsightsData } from "./data";
import { initialReport, PAGES, stackForPhone, type PageId } from "./report";
import { flaggedAnomalyIds, placeAlert, scanRecent } from "./sentinel";
import { insightsTheme } from "./theme";
import { insightsWidgets, type InsightsRegistry } from "./widgets";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

/**
 * AG Studio's licence is its own, separate from AG Grid's. Without one Studio runs in trial mode:
 * it works, with a watermark and console warnings.
 */
const LICENSE_KEY = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY || undefined;
const MODULES = [AgStudioAiModule];

type State = AgReportState<InsightsRegistry>;
const STORAGE_KEY = "agentguard.insights.report.v1";

function savedReport(): State | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const state = raw ? (JSON.parse(raw) as State) : null;
    // Only a report with every page this version expects.
    return state && PAGES.every((p) => state.pages?.some((s) => s.id === p.id)) ? state : null;
  } catch {
    return null;
  }
}
function saveReport(state: State | null) {
  try {
    if (state) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private windows and blocked storage: the layout just isn't remembered.
  }
}

interface AiInfo {
  enabled: boolean;
  models: AgAiModel[];
}

export default function InsightsStudio() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [ai, setAi] = useState<AiInfo | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    () =>
      api<InsightsData>("/api/insights/data")
        .then((d) => {
          setData(d);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [],
  );
  useEffect(() => {
    load();
    // Studio reads its AI setup once, so give a waking API (Render's free plan sleeps) a few tries before going without.
    const aiInfo = (tries: number): Promise<AiInfo> =>
      api<AiInfo>("/api/insights/ai").catch(() =>
        tries > 1 ? new Promise<AiInfo>((resolve) => setTimeout(() => resolve(aiInfo(tries - 1)), 3000)) : { enabled: false, models: [] },
      );
    aiInfo(3).then(setAi);
  }, [load]);

  // Live: refresh Studio's data shortly after payments change, batching bursts from the demo runner.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useLiveEvents((e) => {
    if (e.type !== "payment.created" && e.type !== "payment.updated" && e.type !== "demo.reset" && e.type !== "policy.activated") return;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(load, 1500);
  });
  useEffect(() => () => void (pending.current && clearTimeout(pending.current)), []);

  if (failed && !data) {
    return (
      <div className="sheet px-6 py-12 text-center">
        <p className="section-title">Couldn&apos;t load the data.</p>
        <p className="mx-auto mt-2 max-w-md text-ink-2">Start the API with npm run dev, then reload this page.</p>
      </div>
    );
  }
  if (!data || !ai) return <div className="sheet h-[640px] animate-pulse" aria-label="Loading the dashboard" />;
  return <Dashboard data={data} ai={ai} live={live} />;
}

function Dashboard({ data, ai, live }: { data: InsightsData; ai: AiInfo; live: boolean }) {
  // Read once: Studio takes its initial state and AI setup when it is created.
  const [phone] = useState(() => window.matchMedia("(max-width: 640px)").matches);
  const [initialState] = useState<State>(() => {
    const start = (!phone && savedReport()) || initialReport();
    return phone ? stackForPhone(start) : start;
  });
  const [mode, setMode] = useState<AgStudioMode>(() => (ai.enabled && window.matchMedia("(min-width: 1024px)").matches ? "edit" : "view"));
  const [pageId, setPageId] = useState<string>(initialState.selectedPageId);
  const [note, setNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const apiRef = useRef<AgStudioApi<InsightsRegistry> | null>(null);

  const studioData = useMemo(() => buildStudioData(data), [data]);
  const harness = useMemo(() => (ai.enabled ? insightsAi(ai.models, () => phone) : undefined), [ai, phone]);
  // Narrower than Studio's 720px default, so the canvas still fits beside the open AI panel on a laptop.
  const layout = useMemo(() => ({ minWidth: phone ? 280 : 480, widgetBorderEnabled: true }), [phone]);

  const showPage = (id: PageId) => {
    const studio = apiRef.current;
    if (studio) studio.setState({ ...studio.getState(), selectedPageId: id });
  };

  const resetLayout = () => {
    const studio = apiRef.current;
    if (!studio) return;
    const fresh = initialReport();
    studio.setState(phone ? stackForPhone(fresh) : fresh);
    studio.clearHistory();
    saveReport(null);
  };

  // The Sentinel's rules without the model: flags every finding with the server's own wording.
  const scanNow = async () => {
    const studio = apiRef.current;
    if (!studio) return;
    setScanning(true);
    setNote(null);
    try {
      const { anomalies, windowHours } = await scanRecent();
      const already = flaggedAnomalyIds(studio.getState());
      for (const a of anomalies) placeAlert(studio, a, { headline: a.title, explanation: a.detail }, phone);
      const fresh = anomalies.filter((a) => !already.has(a.id)).length;
      setNote(
        anomalies.length === 0
          ? `Nothing unusual in the last ${windowHours === 168 ? "7 days" : `${windowHours} hours`}.`
          : `${anomalies.length} finding${anomalies.length === 1 ? "" : "s"} in the last ${windowHours === 168 ? "7 days" : `${windowHours} hours`}, flagged on Sentinel alerts${
              fresh < anomalies.length ? ` (${anomalies.length - fresh} refreshed)` : ""
            }.`,
      );
    } catch {
      setNote("The scan failed: the AgentGuard API didn't answer.");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-3">
        <nav className="flex overflow-x-auto rounded-[5px] border border-rule-2 bg-sheet" aria-label="Dashboard pages">
          {PAGES.map((p) => (
            <button
              key={p.id}
              onClick={() => showPage(p.id)}
              aria-current={pageId === p.id ? "page" : undefined}
              className={`shrink-0 border-r border-rule px-3.5 py-1.5 text-[13.5px] whitespace-nowrap last:border-r-0 ${
                pageId === p.id ? "bg-ink text-sheet" : "text-ink-2 hover:bg-paper hover:text-ink"
              }`}
            >
              {p.title}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-ink-3">Mode</span>
          <div className="flex rounded-[5px] border border-rule-2 bg-sheet" role="group" aria-label="Dashboard mode">
            {(
              [
                ["view", "View"],
                ["edit", ai.enabled ? "Build + AI" : "Build"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`border-r border-rule px-3 py-1.5 text-[13px] whitespace-nowrap last:border-r-0 ${mode === m ? "bg-ink text-sheet" : "text-ink-2 hover:bg-paper hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="mark text-[12.5px] text-ink-3" style={{ "--dot": live ? "var(--color-ok)" : "var(--color-rule-2)" } as React.CSSProperties}>
            {live ? "Live" : "Connecting"}
          </span>
          <button className="btn btn-sm btn-quiet" onClick={scanNow} disabled={scanning}>
            {scanning ? "Scanning…" : "Scan now"}
          </button>
          {!phone && (
            <button className="btn btn-sm btn-quiet" onClick={resetLayout}>
              Reset layout
            </button>
          )}
        </div>
      </div>
      {note && (
        <p className="mb-3 text-[13.5px] text-ink-2" role="status">
          {note}
        </p>
      )}
      {!ai.enabled && (
        <p className="mb-3 text-[13px] text-ink-3">
          The AI agents are off: set <code>GEMINI_API_KEY</code> (free at aistudio.google.com) for the API to turn them on.
        </p>
      )}

      <div className="h-[calc(100dvh-260px)] min-h-[560px] overflow-hidden rounded-[6px] border border-rule bg-paper">
        <AgStudioProvider licenseKey={LICENSE_KEY} modules={MODULES}>
          <AgStudio<InsightsRegistry>
            style={{ height: "100%", width: "100%" }}
            theme={insightsTheme}
            loadThemeGoogleFonts={false}
            layout={layout}
            data={studioData}
            widgets={insightsWidgets}
            initialState={initialState}
            mode={mode}
            ai={harness}
            onApiReady={(e) => {
              apiRef.current = e.api as unknown as AgStudioApi<InsightsRegistry>;
            }}
            onStateUpdated={(e) => {
              const state = e.state as State;
              setPageId(state.selectedPageId);
              if (!phone) saveReport(state);
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
