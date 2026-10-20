"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";

export function KillSwitch() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ enabled: boolean }>("/api/killswitch").then((r) => setEnabled(r.enabled)).catch(() => setEnabled(null));
  }, []);
  useLiveEvents((e) => {
    if (e.type === "killswitch") setEnabled(e.enabled);
  });

  const toggle = async () => {
    if (enabled === null) return;
    setBusy(true);
    try {
      const r = await api<{ enabled: boolean }>("/api/killswitch", { json: { enabled: !enabled } });
      setEnabled(r.enabled);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy || enabled === null}
      title={enabled ? "All agent spending is frozen. Click to resume." : "Freeze all agent spending instantly"}
      className={`btn ${enabled ? "bg-bad text-white shadow-[0_0_24px_rgba(239,68,68,.55)]" : "btn-bad"}`}
    >
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${enabled ? "bg-white animate-pulse" : "bg-bad"}`} />
      {enabled ? "SPENDING FROZEN" : "Kill switch"}
    </button>
  );
}
