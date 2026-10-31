"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cover } from "./Cover";
import { Icon } from "./Icon";
import { usePlayer } from "@/lib/player";
import { fmtDuration, haptic } from "@/lib/telegram";

/** Compact persistent player, shown above the tab bar on every page
 *  except the full-screen player. */
export function MiniPlayer() {
  const { current, isPlaying, progress, toggle, next, audioError } = usePlayer();
  const pathname = usePathname();

  if (!current || pathname === "/player/") return null;
  const pct = Math.min(100, (progress / Math.max(1, current.duration_seconds)) * 100);

  return (
    <Link
      href={`/player/?id=${current.id}`}
      className="fixed inset-x-0 z-40 mx-auto max-w-[30rem] px-2"
      style={{ bottom: "calc(var(--nav-h) + max(env(safe-area-inset-bottom), 6px) + 8px)" }}
      onClick={() => haptic("light")}
    >
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/95 shadow-2xl shadow-black/60 backdrop-blur-xl">
        <div
          className="absolute left-0 top-0 h-[2.5px] bg-[var(--gold)] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
        <div className="flex items-center gap-3 p-2.5">
          <Cover
            seed={current.id}
            imageUrl={current.cover_url}
            className="h-11 w-11 shrink-0"
            rounded="rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold leading-tight">{current.title}</p>
            <p className="truncate text-[12px] text-[var(--muted)]">
              {audioError ? "Demo audio unavailable offline" : current.artist?.name ?? ""}
            </p>
          </div>
          <button
            aria-label={isPlaying ? "Pause" : "Play"}
            className="press flex h-10 w-10 items-center justify-center rounded-full bg-[var(--gold)] text-black"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggle();
            }}
          >
            <Icon name={isPlaying ? "pause" : "play"} className="h-5 w-5" />
          </button>
          <button
            aria-label="Next song"
            className="press flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)]"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              next();
            }}
          >
            <Icon name="next" className="h-5 w-5" />
          </button>
        </div>
        <span className="sr-only">{fmtDuration(progress)} elapsed</span>
      </div>
    </Link>
  );
}
