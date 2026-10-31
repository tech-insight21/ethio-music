"use client";

import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { haptic, useTelegramBackButton } from "@/lib/telegram";

interface PageHeaderProps {
  title: string;
  back?: boolean;
  action?: React.ReactNode;
  subtitle?: string;
}

export function PageHeader({ title, back = true, action, subtitle }: PageHeaderProps) {
  const router = useRouter();
  useTelegramBackButton(back);

  return (
    <header className="sticky top-0 z-20 -mx-3 mb-2 flex items-center gap-2 bg-[var(--bg)]/85 px-3 py-2.5 backdrop-blur-xl">
      {back && (
        <button
          aria-label="Go back"
          className="press -ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--card)]"
          onClick={() => {
            haptic("light");
            router.back();
          }}
        >
          <Icon name="chevronLeft" className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[17px] font-bold leading-tight">{title}</h1>
        {subtitle && <p className="truncate text-xs text-[var(--muted)]">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
