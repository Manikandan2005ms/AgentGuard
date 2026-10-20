import { ImageResponse } from "next/og";

// Social preview card for links to the dashboard (Devpost, chat apps). Rendered at build time.
export const alt = "AgentGuard: a spending firewall for AI agents, powered by PayPal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const pill = (text: string, color: string) => (
  <div
    style={{
      display: "flex",
      padding: "10px 22px",
      borderRadius: 999,
      border: `2px solid ${color}`,
      color,
      fontSize: 26,
      fontWeight: 700,
    }}
  >
    {text}
  </div>
);

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "70px 80px",
          background: "linear-gradient(135deg, #070b14 0%, #0d1424 60%, #0b2230 100%)",
          color: "#e6ebf5",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <svg width="96" height="96" viewBox="0 0 64 64">
            <path d="M32 9 13 16v14c0 12.5 8.1 23.4 19 27 10.9-3.6 19-14.5 19-27V16L32 9Z" fill="rgba(34,211,238,0.18)" stroke="#22d3ee" strokeWidth="3.5" />
            <path d="m23 32.5 6.5 6.5L41.5 26" fill="none" stroke="#22d3ee" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, letterSpacing: -2 }}>
            Agent<span style={{ color: "#22d3ee" }}>Guard</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 54, fontWeight: 700, lineHeight: 1.15 }}>A spending firewall for AI agents</div>
          <div style={{ display: "flex", fontSize: 30, color: "#8b98b8" }}>
            Give an agent your PayPal wallet without giving it a blank cheque.
          </div>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          {pill("Auto-approve", "#22c55e")}
          {pill("Ask on your phone", "#f59e0b")}
          {pill("Block prompt injection", "#ef4444")}
        </div>
      </div>
    ),
    size,
  );
}
