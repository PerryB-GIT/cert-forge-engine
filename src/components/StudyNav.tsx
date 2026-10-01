"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Sub-nav for the Study Lab. The header already carries seven links; rather than
 * pushing it to ten, the three review surfaces share one entry and switch here.
 */
const TABS = [
  { href: "/study", label: "Study sheets", match: /^\/study/ },
  { href: "/missed", label: "Missed answers", match: /^\/missed/ },
  { href: "/flashcards", label: "Flashcards", match: /^\/flashcards/ },
];

export function StudyNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-edge bg-surface p-1 text-sm print:hidden">
      {TABS.map((t) => {
        const active = t.match.test(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 font-semibold transition ${
              active ? "bg-accent text-white" : "text-ink2 hover:bg-surface2 hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
