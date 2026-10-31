"use client";

export type Tab = "home" | "search" | "library" | "premium";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "search", label: "Search", icon: "🔍" },
  { id: "library", label: "Library", icon: "📚" },
  { id: "premium", label: "Premium", icon: "⭐" },
];

interface TabBarProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/5 bg-[var(--tg-card)] pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          aria-label={t.label}
          aria-current={active === t.id ? "page" : undefined}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
            active === t.id ? "text-[var(--tg-accent)]" : "text-[var(--tg-hint)]"
          }`}
          onClick={() => onChange(t.id)}
        >
          <span className="text-lg leading-none">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
