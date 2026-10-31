"use client";

import { fmtDuration } from "@/lib/telegram";
import { Song } from "@/lib/supabase";

export function Equalizer({ active }: { active: boolean }) {
  return (
    <span className="flex h-4 w-4 items-end gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-sm bg-[var(--tg-green)] ${active ? "eq-bar" : ""}`}
          style={{ height: "100%", animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

interface SongRowProps {
  song: Song;
  index?: number;
  isCurrent: boolean;
  isPlaying: boolean;
  isFavorite: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
}

export function SongRow({
  song,
  index,
  isCurrent,
  isPlaying,
  isFavorite,
  onPlay,
  onToggleFavorite,
}: SongRowProps) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
        isCurrent ? "bg-[var(--tg-card-2)]" : "bg-transparent"
      } active:bg-[var(--tg-card-2)]`}
      role="button"
      aria-label={`Play ${song.title}`}
      onClick={onPlay}
    >
      {index !== undefined && (
        <span className="w-5 shrink-0 text-center text-sm text-[var(--tg-hint)]">
          {isCurrent && isPlaying ? <Equalizer active /> : index + 1}
        </span>
      )}

      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[var(--tg-card-2)]">
        {song.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={song.cover_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg">🎵</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium leading-tight">{song.title}</p>
        <p className="truncate text-[13px] text-[var(--tg-hint)]">
          {song.artist?.name ?? "Unknown artist"}
          {song.genres.length > 0 && song.genres[0].genres
            ? ` · ${song.genres[0].genres.name}`
            : ""}
        </p>
      </div>

      <button
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        className="shrink-0 px-1 text-lg"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
      >
        {isFavorite ? "❤️" : "🤍"}
      </button>

      <span className="w-9 shrink-0 text-right text-xs text-[var(--tg-hint)]">
        {fmtDuration(song.duration_seconds)}
      </span>
    </div>
  );
}
