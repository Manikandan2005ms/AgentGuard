import { ImageResponse } from "next/og";

// Social preview card for links to the dashboard (Devpost, chat apps). Rendered at build time.
export const alt = "AgentGuard: a spending firewall for AI agents, powered by PayPal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const stamp = (text: string, color: string) => (
  <div
    style={{
      display: "flex",
      padding: "6px 16px 4px",
      borderRadius: 6,
      border: `3px solid ${color}`,
      color,
      fontSize: 24,
      fontWeight: 700,
      letterSpacing: 3,
      textTransform: "uppercase",
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
          padding: "72px 84px",
          background: "#f3efe6",
          color: "#1d1c19",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22, borderBottom: "2px solid #c4bba7", paddingBottom: 28 }}>
          <svg width="64" height="64" viewBox="0 0 24 24">
            <path d="M12 2.2 4.2 5v6.3c0 4.8 3.2 8.9 7.8 10.5 4.6-1.6 7.8-5.7 7.8-10.5V5L12 2.2Z" fill="#1d1c19" />
            <rect x="7.6" y="10.4" width="8.8" height="2.4" rx="1.2" fill="#f3efe6" />
          </svg>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700, letterSpacing: -1 }}>AgentGuard</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 72, lineHeight: 1.05, letterSpacing: -1.5 }}>A spending firewall for AI agents.</div>
          <div style={{ display: "flex", fontSize: 30, color: "#59554c", fontFamily: "sans-serif" }}>
            Give an agent your PayPal wallet without giving it a blank cheque.
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, fontFamily: "sans-serif" }}>
          {stamp("Approved", "#2e6a3c")}
          {stamp("Asked you", "#995a0b")}
          {stamp("Blocked", "#ad3826")}
        </div>
      </div>
    ),
    size,
  );
}
