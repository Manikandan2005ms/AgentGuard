import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";

// Self-hosted at build time by next/font. The CSS variables are wired into Tailwind in globals.css;
// canvas-based AG Charts needs the real family names, so they're exported too.
export const serif = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"], variable: "--font-newsreader" });
export const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans" });
export const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });
