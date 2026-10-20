const c = (code: number) => (s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = c(1);
export const dim = c(2);
export const red = c(31);
export const green = c(32);
export const yellow = c(33);
export const blue = c(34);
export const magenta = c(35);
export const cyan = c(36);

export const log = {
  agent: (s: string) => console.log(`${cyan("🤖 agent")}   ${s}`),
  tool: (name: string, s: string) => console.log(`${magenta("🔧 " + name.padEnd(18))} ${dim(s)}`),
  guard: (status: string, s: string) => {
    const color = status === "approved" ? green : status === "pending_approval" ? yellow : red;
    const icon = status === "approved" ? "✅" : status === "pending_approval" ? "📱" : "⛔";
    console.log(`${color(`${icon} AgentGuard ${status.toUpperCase()}`)}  ${s}`);
  },
  store: (s: string) => console.log(`${yellow("💳 store")}   ${s}`),
  info: (s: string) => console.log(dim(s)),
  title: (s: string) => console.log(`\n${bold(s)}\n${dim("─".repeat(Math.min(80, s.length + 4)))}`),
};
