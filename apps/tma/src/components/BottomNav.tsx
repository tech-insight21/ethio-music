"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";
import { haptic } from "@/lib/telegram";

const TABS: { href: string; label: string; icon: IconName; exact?: boolean }[] = [
  { href: "/", label: "Home", icon: "home", exact: true },
  { href: "/search/", label: "Search", icon: "search" },
  { href: "/trending/", label: "Trending", icon: "flame" },
  { href: "/library/", label: "Library", icon: "library" },
  { href: "/profile/", label: "Profile", icon: "user" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[30rem] items-stretch border-t border-[var(--border)] bg-[var(--bg)]/90 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 backdrop-blur-2xl"
      style={{ height: "calc(var(--nav-h) + max(env(safe-area-inset-bottom), 6px))" }}
    >
      {TABS.map((t) => {
        const active = t.exact ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            onClick={() => haptic("light")}
            className={`press flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium ${
              active ? "text-[var(--gold)]" : "text-[var(--muted)]"
            }`}
          >
            <Icon name={t.icon} className="h-[22px] w-[22px]" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
