"use client";

import dynamic from "next/dynamic";

const AuditGrid = dynamic(() => import("@/components/AuditGrid"), {
  ssr: false,
  loading: () => <div className="card p-8 text-center text-muted">Loading audit log…</div>,
});

export default function AuditPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-muted">
          Every decision with the rules that fired, the risk signals and the AI explanation. Expand a row for the full trail; drag a
          column header to the bar to group by it.
        </p>
      </div>
      <AuditGrid />
    </div>
  );
}
