"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type MeResponse } from "@/lib/api";
import { KillSwitch } from "./KillSwitch";

const NAV = [
  { href: "/", label: "Live" },
  { href: "/try", label: "▶ Try it" },
  { href: "/policies", label: "Policies" },
  { href: "/audit", label: "Audit log" },
  { href: "/budgets", label: "Budgets" },
  { href: "/threats", label: "Threats" },
  { href: "/setup", label: "Setup" },
];

export function Shield({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="#22d3ee" fillOpacity=".15" stroke="#22d3ee" strokeWidth="1.6" />
      <path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="#22d3ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${ok ? "border-ok/30 text-ok" : "border-warn/30 text-warn"}`}>
      {children}
    </span>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api<MeResponse>("/api/me")
      .then((m) => {
        setMe(m);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, [path]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Shield />
            <span className="text-lg font-bold tracking-tight">
              Agent<span className="text-shield">Guard</span>
            </span>
          </Link>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {me && (
              <div className="hidden items-center gap-1.5 lg:flex">
                <Badge ok={me.modes.paypal === "sandbox"}>PayPal {me.modes.paypal}</Badge>
                <Badge ok={me.modes.llm.enabled}>{me.modes.llm.enabled ? "AI: Claude" : "AI: heuristics"}</Badge>
                <Badge ok={me.user.telegramConnected}>{me.user.telegramConnected ? "Phone linked" : "No phone"}</Badge>
              </div>
            )}
            <KillSwitch />
          </div>
        </div>
      </header>
      {offline && (
        <div className="border-b border-bad/40 bg-bad/10 px-4 py-2 text-center text-sm text-bad">
          Can&apos;t reach the AgentGuard API. Is it running? (npm run dev)
        </div>
      )}
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
