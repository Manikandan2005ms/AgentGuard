import type { Metadata, Viewport } from "next";
import { Shell } from "@/components/Shell";
import { mono, sans, serif } from "@/lib/fonts";
import "./globals.css";

const description = "Policies, risk scoring, one-tap approvals and a full audit trail for agent payments on PayPal.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "AgentGuard: a spending firewall for AI agents",
  description,
  openGraph: { title: "AgentGuard: a spending firewall for AI agents", description, type: "website", siteName: "AgentGuard" },
  twitter: { card: "summary_large_image", title: "AgentGuard", description },
};

export const viewport: Viewport = {
  themeColor: "#f3efe6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
