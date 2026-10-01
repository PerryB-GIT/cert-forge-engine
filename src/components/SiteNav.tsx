"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Header navigation.
 *
 * The eight links used to sit in one horizontally-scrolling row. On a 390px
 * phone that put 809px of content in a 248px window with no fade or chevron —
 * only "Readiness" was visible and the other seven were undiscoverable. Below
 * `md` this collapses into a labelled menu instead; at `md` and up the row fits
 * and behaves as before.
 */
export type NavItem = { href: string; label: string };

export function SiteNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // The panel closes from the link's own onClick rather than an effect watching
  // pathname — closing is a consequence of the click, not of the route.

  // Escape should dismiss, like any other popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* wide: the full row */}
      <nav className="hidden gap-1 text-sm md:flex">
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={isActive(n.href) ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 transition hover:bg-surface2 hover:text-ink ${
              isActive(n.href) ? "bg-surface2 font-semibold text-ink" : "text-ink2"
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      {/* narrow: a menu button + panel */}
      <div className="relative md:hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="site-menu"
          className="flex items-center gap-2 rounded-lg border border-edge bg-surface2 px-3 py-1.5 text-sm font-semibold text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d={open ? "M2 2 L12 12 M12 2 L2 12" : "M1 3h12M1 7h12M1 11h12"}
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
          {items.find((n) => isActive(n.href))?.label ?? "Menu"}
        </button>

        {open && (
          <>
            {/* click-away */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              id="site-menu"
              className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-edge bg-surface shadow-xl"
            >
              {items.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={`block px-4 py-2.5 text-sm transition hover:bg-surface2 ${
                    isActive(n.href) ? "bg-surface2 font-semibold text-accenthi" : "text-ink2"
                  }`}
                >
                  {n.label}
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
