import type { Metadata } from "next";
import { Geist_Mono, Inter, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import "./globals.css";

// Support Forge brand faces (Inter body, Space Grotesk headings).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
// Not a brand face: the SF site has no mono, but scores/timers here are tabular numerals
// that need one. Geist Mono stays for those.
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Cert Forge — Anthropic Partner Certification Tracker",
  description:
    "Study tracker and exam simulator for the Anthropic Partner Certification program. A Support Forge tool.",
};

// One entry per surface, except the three review surfaces (study sheets, missed
// answers, flashcards) which share the Study Lab entry and switch via <StudyNav>.
// Ten header links do not fit a phone; seven already scroll.
const NAV = [
  { href: "/", label: "Readiness" },
  { href: "/practice", label: "Practice" },
  { href: "/study", label: "Study Lab" },
  { href: "/simulate", label: "Exam Simulator" },
  { href: "/report", label: "Report Card" },
  { href: "/scoreboard", label: "Scoreboard" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/chronicle", label: "Chronicle" },
  { href: "/exam-order", label: "Exam Order" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg text-ink">
        <header className="sticky top-0 z-40 border-b border-edge bg-bg/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="flex shrink-0 items-baseline gap-2">
              <span className="font-heading text-lg font-bold tracking-tight">
                <span className="text-accenthi">CERT</span> FORGE
              </span>
              <span className="hidden text-xs text-ink3 sm:inline">by Support Forge</span>
            </Link>
            <SiteNav items={NAV} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 py-8 text-xs text-ink3">
          Cert Forge · a Support Forge tool — Practice content is original,
          written against the public exam guides. Not affiliated with Anthropic or Pearson VUE.
        </footer>
      </body>
    </html>
  );
}
