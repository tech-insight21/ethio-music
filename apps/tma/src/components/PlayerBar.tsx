"use client";

import { Song } from "@/lib/supabase";
import { fmtDuration } from "@/lib/telegram";

interface PlayerBarProps {
  song: Song | null;
  isPlaying: boolean;
  progress: number; // 0..1
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export function PlayerBar({ song, isPlaying, progress, onToggle, onNext, onPrev }: PlayerBarProps) {
  if (!song) return null;
  return (
    <div
      className="fixed inset-x-0 bottom-16 z-30 mx-2 rounded-2xl border border-white/5 bg-[var(--tg-card)] p-2.5 shadow-xl"
      style={{ background: "var(--tg-card)" }}
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[var(--tg-card-2)]">
          {song.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={song.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">🎵</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{song.title}</p>
          <p className="truncate text-xs text-[var(--tg-hint)]">{song.artist?.name}</p>
        </div>
        <button aria-label="Previous" className="px-1.5 text-lg" onClick={onPrev}>
          ⏮️
        </button>
        <button
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--tg-accent)] text-lg text-black"
          onClick={onToggle}
        >
          {isPlaying ? "⏸" : "▶️"}
        </button>
        <button aria-label="Next" className="px-1.5 text-lg" onClick={onNext}>
          ⏭️
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-[var(--tg-hint)]">{fmtDuration(progress * song.duration_seconds)}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[var(--tg-accent)] transition-[width] duration-300"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-[var(--tg-hint)]">{fmtDuration(song.duration_seconds)}</span>
      </div>
    </div>
  );
}
