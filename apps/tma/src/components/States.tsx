"use client";

import { Icon } from "./Icon";
import { haptic } from "@/lib/telegram";

/* Loading / empty / error states — every async surface uses these. */

export function SkeletonRows({ n = 5, cover = true }: { n?: number; cover?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-white/5">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-1 py-3">
          {cover && <div className="skeleton h-12 w-12 shrink-0" />}
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-3/5" />
            <div className="skeleton h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ n = 3 }: { n?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="w-36 shrink-0 space-y-2">
          <div className="skeleton aspect-square w-full" />
          <div className="skeleton h-3.5 w-4/5" />
          <div className="skeleton h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonHero() {
  return (
    <div className="skeleton h-40 w-full rounded-2xl" />
  );
}

export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-[var(--muted)]">
      <div className="flex items-end gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="eq-bar w-1.5 rounded-full bg-[var(--gold)]"
            style={{ height: 22, animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  icon = "🎵",
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="anim-rise flex flex-col items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-10 text-center">
      <span className="text-3xl" aria-hidden>{icon}</span>
      <p className="text-[15px] font-semibold">{title}</p>
      {body && <p className="max-w-xs text-[13px] leading-relaxed text-[var(--muted)]">{body}</p>}
      {action && (
        <button
          className="press mt-2 rounded-full bg-[var(--gold)] px-5 py-2 text-[13px] font-semibold text-black"
          onClick={() => {
            haptic("light");
            action.onClick();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="anim-rise flex flex-col items-center gap-3 rounded-2xl border border-[var(--red)]/30 bg-[var(--red)]/10 px-6 py-8 text-center"
    >
      <span className="text-2xl" aria-hidden>📡</span>
      <div>
        <p className="text-[15px] font-semibold">Connection problem</p>
        <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-[var(--muted)]">
          {message ?? "We couldn't reach the ETHIO MUSIC catalog. Check your network and try again."}
        </p>
      </div>
      <button
        className="press inline-flex items-center gap-1.5 rounded-full bg-[var(--card-2)] px-4 py-2 text-[13px] font-semibold"
        onClick={() => {
          haptic("light");
          onRetry();
        }}
      >
        <Icon name="refresh" className="h-4 w-4" /> Retry
      </button>
    </div>
  );
}

/** Shown when a feature genuinely requires backend services that are not
 *  deployed yet. Never fakes success. */
export function BackendNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--gold)]/25 bg-[var(--gold)]/10 p-4">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--gold)]">
        <Icon name="star" className="h-4 w-4" /> Backend integration required
      </p>
      <div className="mt-1.5 text-[13px] leading-relaxed text-[var(--text)]/80">{children}</div>
    </div>
  );
}
