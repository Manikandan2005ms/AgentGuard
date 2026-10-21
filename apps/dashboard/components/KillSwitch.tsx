"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";

/** The kill switch state. "frozen" means the switch is on and no agent can move money. */
export function useKillSwitch() {
  const [frozen, setFrozen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ enabled: boolean }>("/api/killswitch").then((r) => setFrozen(r.enabled)).catch(() => setFrozen(null));
  }, []);
  useLiveEvents((e) => {
    if (e.type === "killswitch") setFrozen(e.enabled);
    if (e.type === "demo.reset") setFrozen(false); // the reset turns the switch off
  });

  const toggle = async () => {
    if (frozen === null) return;
    setBusy(true);
    try {
      const r = await api<{ enabled: boolean }>("/api/killswitch", { json: { enabled: !frozen } });
      setFrozen(r.enabled);
    } finally {
      setBusy(false);
    }
  };

  return { frozen, busy, toggle };
}

type KillSwitch = ReturnType<typeof useKillSwitch>;

export function FreezeButton({ frozen, busy, toggle }: KillSwitch) {
  if (frozen) {
    return (
      <button onClick={toggle} disabled={busy} className="btn btn-sm btn-approve" title="Let agents spend again, within your rules">
        {busy ? "Resuming…" : "Resume spending"}
      </button>
    );
  }
  return (
    <button
      onClick={toggle}
      disabled={busy || frozen === null}
      className="btn btn-sm btn-reject"
      title="Stop every agent payment immediately. Nothing is charged until you resume."
    >
      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
        <rect width="12" height="12" rx="2" fill="currentColor" />
      </svg>
      {busy ? "Freezing…" : "Freeze spending"}
    </button>
  );
}

export function FrozenBanner() {
  return (
    <div
      role="status"
      className="border-b border-[#8a2b1c] text-white"
      style={{ background: "repeating-linear-gradient(-45deg, #ad3826 0 14px, #a13321 14px 28px)" }}
    >
      <p className="mx-auto max-w-[1240px] px-4 py-2.5 text-[14px] sm:px-8">
        <b className="font-semibold">Spending is frozen.</b> Agents can&apos;t move any money until you resume. Requests are still logged and blocked.
      </p>
    </div>
  );
}
