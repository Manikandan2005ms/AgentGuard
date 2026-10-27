"use client";

import dynamic from "next/dynamic";
import { PageHeader } from "@/components/PageHeader";

// AG Studio measures and draws in the browser, so it skips server rendering.
const InsightsStudio = dynamic(() => import("@/components/insights/InsightsStudio"), {
  ssr: false,
  loading: () => <div className="sheet h-[640px] animate-pulse" aria-label="Loading the dashboard" />,
});

export default function InsightsPage() {
  return (
    <div>
      <PageHeader title="Insights">
        Every decision AgentGuard made, as a dashboard you can rearrange. In Build mode, ask the agents in plain English to add a chart, or ask
        the Sentinel to flag anything unusual in the payment stream. They run on Gemini&apos;s free tier.
      </PageHeader>
      <InsightsStudio />
    </div>
  );
}
