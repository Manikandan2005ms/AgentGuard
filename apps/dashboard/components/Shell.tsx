"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type MeResponse } from "@/lib/api";
import { FreezeButton, FrozenBanner, useKillSwitch } from "./KillSwitch";

const NAV = [
  { href: "/", label: "Live" },
  { href: "/try", label: "Try it" },
  { href: "/policies", label: "Policies" },
  { href: "/audit", label: "Audit log" },
  { href: "/budgets", label: "Budgets" },
  { href: "/threats", label: "Threats" },
  { href: "/setup", label: "Setup" },
];

/** A shield with a bar across it: the gate every agent payment passes through. */
export function Mark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 2.2 4.2 5v6.3c0 4.8 3.2 8.9 7.8 10.5 4.6-1.6 7.8-5.7 7.8-10.5V5L12 2.2Z" fill="currentColor" />
      <rect x="7.6" y="10.4" width="8.8" height="2.4" rx="1.2" fill="var(--color-paper)" />
    </svg>
  );
}

function Fact({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="mark" style={{ "--dot": ok ? "var(--color-ok)" : "var(--color-warn)" } as React.CSSProperties}>
      {children}
    </li>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const killSwitch = useKillSwitch();

  useEffect(() => {
    api<MeResponse>("/api/me")
      .then((m) => {
        setMe(m);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, [path]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
          <div className="flex items-center gap-4 pt-4 pb-2.5">
            <Link href="/" className="flex items-center gap-2 text-ink">
              <Mark />
              <span className="font-serif text-[23px] font-semibold leading-none tracking-[-0.01em]">AgentGuard</span>
            </Link>
            <span className="hidden border-l border-rule-2 pl-4 font-serif text-[15px] italic text-ink-2 md:inline">a spending firewall for AI agents</span>
            <div className="ml-auto flex items-center gap-6">
              {me && (
                <ul className="hidden items-center gap-4 lg:flex" aria-label="Environment">
                  <Fact ok={me.modes.paypal === "sandbox"}>{me.modes.paypal === "sandbox" ? "PayPal sandbox" : "Mock PayPal"}</Fact>
                  <Fact ok={me.modes.llm.enabled}>{me.modes.llm.enabled ? "Claude checks on" : "Heuristics only"}</Fact>
                  <Fact ok={me.user.telegramConnected}>{me.user.telegramConnected ? "Phone linked" : "No phone linked"}</Fact>
                </ul>
              )}
              <FreezeButton {...killSwitch} />
            </div>
          </div>
          <nav className="-mb-px flex gap-5 overflow-x-auto [scrollbar-width:none] sm:gap-7 [&::-webkit-scrollbar]:hidden" aria-label="Sections">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 whitespace-nowrap border-b-2 py-2.5 text-[14px] ${
                    active ? "border-ink font-semibold text-ink" : "border-transparent text-ink-2 hover:border-rule-2 hover:text-ink"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {killSwitch.frozen && <FrozenBanner />}
      {offline && (
        <div className="border-b border-rule bg-warn-wash">
          <p className="mx-auto max-w-[1240px] px-4 py-2.5 text-[14px] text-warn sm:px-8">
            The AgentGuard API isn&apos;t answering. Start it with <code>npm run dev</code>, then reload this page.
          </p>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-8 sm:px-8 sm:py-10">{children}</main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-5 text-[13px] text-ink-3 sm:px-8">
          <span>Rules are enforced by plain code. AI can raise a payment&apos;s risk, never lower it.</span>
          <a className="ml-auto hover:text-ink" href="https://github.com/Manikandan2005ms/AgentGuard" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
