"use client";

import dynamic from "next/dynamic";
import { PageHeader } from "@/components/PageHeader";

const AuditGrid = dynamic(() => import("@/components/AuditGrid"), {
  ssr: false,
  loading: () => <div className="sheet p-10 text-center text-ink-3">Loading the audit log…</div>,
});

export default function AuditPage() {
  return (
    <div>
      <PageHeader title="Audit log">
        Every decision AgentGuard has made, with the rules that fired, the risk signals and the explanation. Open a row with its arrow for the full trail. To
        group, drag a column header into the bar above the table; to chart, select some cells and right-click, then <i>Chart Range</i>.
      </PageHeader>
      <AuditGrid />
    </div>
  );
}
